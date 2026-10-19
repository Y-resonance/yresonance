import { describe, expect, test } from 'vitest';
import { Route } from '../../src/routes/api.yresonance';
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

  test('rejects cross-origin, non-JSON and oversized requests before service execution', async () => {
    await signInToNewWorkspace();
    const handlers = Route.options.server!.handlers!;
    if (typeof handlers === 'function') throw new Error('Expected configured handlers');
    const handler = handlers.POST;
    if (typeof handler !== 'function') throw new Error('POST handler missing');
    for (const [headers, body, status] of [
      [
        { 'content-type': 'application/json', origin: 'https://attacker.test' },
        '{"action":"bootstrap"}',
        403,
      ],
      [{ 'content-type': 'text/plain' }, '{"action":"bootstrap"}', 415],
      [{ 'content-type': 'application/json' }, 'x'.repeat(1024 * 1024 + 1), 413],
      [{ 'content-type': 'application/json' }, '{', 400],
    ] as const) {
      const response = await handler({
        request: new Request('https://yresonance.test/api/yresonance', {
          method: 'POST',
          headers,
          body,
        }),
      } as Parameters<typeof handler>[0]);
      if (!(response instanceof Response)) throw new Error('Expected an HTTP response');
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('bounds validation details for large malformed arrays', async () => {
    await signInToNewWorkspace();
    const response = await postApiRequest({
      action: 'updateLayout',
      dashboardId: 'missing',
      pageId: 'missing',
      canvasRows: 10,
      placements: Array(100).fill({}),
    });
    expect(response.status).toBe(400);
    const issues = (await envelope(response)).error?.issues;
    expect(issues).toBeInstanceOf(Array);
    expect((issues as unknown[]).length).toBeLessThanOrEqual(20);
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
