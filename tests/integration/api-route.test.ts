import { describe, expect, test } from 'vitest';
import { signOut } from './doubles/clerk';
import { queryEngine } from './doubles/query-engine';
import {
  addWidget,
  createDashboard,
  postApiRequest,
  regionControlDefinition,
  scorecardDefinition,
  seedDataSource,
  signInToNewWorkspace,
} from './fixtures';

interface ApiEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; issues?: unknown };
}

const envelope = (response: Response) => response.json() as Promise<ApiEnvelope>;

describe('POST /api/yresonance', () => {
  test('a successful request answers with an uncacheable success envelope', async () => {
    const workspace = await signInToNewWorkspace();
    await seedDataSource(workspace);

    const response = await postApiRequest({ action: 'bootstrap' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await envelope(response);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ workspace: { id: workspace.workspaceId } });
  });

  test('an unknown action is rejected before the service runs', async () => {
    await signInToNewWorkspace();

    const response = await postApiRequest({ action: 'deleteEverything' });

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await envelope(response);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_request');
    expect(body.error?.issues).toBeDefined();
  });

  test('a malformed widget definition is reported with its validation issues', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();

    const response = await postApiRequest({
      action: 'addWidget',
      pageId: `${dashboard.id}_page`,
      dashboardId: dashboard.id,
      definition: { ...scorecardDefinition(source), title: '' },
      width: 4,
      height: 3,
    });

    expect(response.status).toBe(400);
    expect((await envelope(response)).error?.code).toBe('invalid_request');
  });

  test('an unauthenticated request answers 401 rather than leaking a stack', async () => {
    signOut();

    const response = await postApiRequest({ action: 'listDashboards' });

    expect(response.status).toBe(401);
    const body = await envelope(response);
    expect(body.error).toEqual({
      code: 'unauthenticated',
      message: 'Sign in to continue.',
      issues: undefined,
    });
  });

  test('an engine outage answers 502 rather than an invalid-query error', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const widget = await addWidget(dashboard.id, scorecardDefinition(source));
    queryEngine.rejectQueries(503, 'container 10.0.0.4 refused the connection');

    const response = await postApiRequest({
      action: 'queryWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
    });

    // A connector that cannot answer is an upstream failure, not a bad request.
    expect(response.status).toBe(502);
    const body = await envelope(response);
    expect(body.error?.code).toBe('datasource_connector_failed');
    // The transport detail stays in the log rather than reaching the browser.
    expect(body.error?.message).toBe('The query service is unavailable. Try again.');
    expect(JSON.stringify(body)).not.toContain('10.0.0.4');
  });

  test('a filter control is added through the route and compiles to no SQL', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();

    const response = await postApiRequest({
      action: 'addWidget',
      pageId: `${dashboard.id}_page`,
      dashboardId: dashboard.id,
      definition: regionControlDefinition(source),
      width: 4,
      height: 2,
    });

    expect(response.status).toBe(200);
    const body = await envelope(response);
    expect(body.data).toMatchObject({
      widget: { definition: { type: 'control', fieldId: source.fieldIds.region } },
      compiledSql: null,
    });
    // Controls never reach the query engine when they are saved.
    expect(queryEngine.calls).toEqual([]);
  });
});
