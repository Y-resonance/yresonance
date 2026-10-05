import { describe, expect, test } from 'vitest';
import { signInAs, signOut } from './doubles/clerk';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  scorecardDefinition,
  seedDataSource,
  signInToNewWorkspace,
} from './fixtures';

describe('workspace tenancy', () => {
  test('a workspace only ever sees its own dashboards and datasources', async () => {
    const first = await signInToNewWorkspace();
    const firstSource = await seedDataSource(first);
    const firstDashboard = await createDashboard('Quarterly revenue');
    await addWidget(firstDashboard.id, scorecardDefinition(firstSource));

    const second = await signInToNewWorkspace();
    await seedDataSource(second);

    const bootstrap = (await callService({ action: 'bootstrap' })) as {
      workspace: { id: string };
      dashboards: Array<{ id: string }>;
      dataSources: Array<{ id: string }>;
    };
    expect(bootstrap.workspace.id).toBe(second.workspaceId);
    expect(bootstrap.dashboards).toEqual([]);
    expect(bootstrap.dataSources.map((source) => source.id)).not.toContain(firstSource.id);
  });

  test('another workspace cannot open or edit a dashboard it does not own', async () => {
    const owner = await signInToNewWorkspace();
    const source = await seedDataSource(owner);
    const dashboard = await createDashboard();
    const widget = await addWidget(dashboard.id, scorecardDefinition(source));

    await signInToNewWorkspace();
    // Foreign dashboards report as missing rather than forbidden, so ids stay unguessable.
    await expectApiError(callService({ action: 'getDashboard', dashboardId: dashboard.id }), {
      status: 404,
      code: 'dashboard_not_found',
    });
    await expectApiError(
      callService({ action: 'updateDashboard', dashboardId: dashboard.id, name: 'Renamed' }),
      { status: 404, code: 'dashboard_not_found' },
    );
    await expectApiError(
      callService({ action: 'queryWidget', dashboardId: dashboard.id, widgetId: widget.id }),
      { status: 404, code: 'dashboard_not_found' },
    );
  });

  test('a dashboard cannot be built on another workspace datasource', async () => {
    const owner = await signInToNewWorkspace();
    const foreignSource = await seedDataSource(owner);

    await signInToNewWorkspace();
    await expectApiError(
      callService({
        action: 'createDashboard',
        name: 'Borrowed data',
        dataSourceIds: [foreignSource.id],
      }),
      { status: 400, code: 'invalid_datasource' },
    );
    await expectApiError(
      callService({ action: 'describeDatasource', dataSourceId: foreignSource.id }),
      { status: 404, code: 'datasource_not_found' },
    );

    const dashboard = await createDashboard();
    await expectApiError(
      callService({
        action: 'addWidget',
        pageId: `${dashboard.id}_page`,
        dashboardId: dashboard.id,
        definition: scorecardDefinition(foreignSource),
        width: 4,
        height: 3,
      }),
      { status: 404, code: 'datasource_not_found' },
    );
  });

  test('datasource keys outside the workspace prefix are rejected', async () => {
    const workspace = await signInToNewWorkspace();
    await expectApiError(
      callService({
        action: 'registerDatasource',
        name: 'Someone else data',
        location: { kind: 'object', key: 'ws/other-workspace/report.csv', format: 'csv' },
      }),
      { status: 400, code: 'invalid_r2_prefix' },
    );
    await expectApiError(
      callService({
        action: 'registerDatasource',
        name: 'Traversal',
        location: { kind: 'object', key: `${workspace.r2Prefix}../escape.csv`, format: 'csv' },
      }),
      { status: 400, code: 'invalid_r2_prefix' },
    );
  });

  test('managed upload keys must match their declared format', async () => {
    const workspace = await signInToNewWorkspace();
    const key = `${workspace.r2Prefix}uploads/2026-09-01/550e8400-e29b-41d4-a716-446655440000.parquet`;

    await expectApiError(
      callService({
        action: 'registerDatasource',
        name: 'Mismatched upload',
        location: { kind: 'object', key, format: 'csv' },
      }),
      { status: 400, code: 'invalid_upload_format' },
    );
  });

  test('a request without a session or an organization never reaches a workspace', async () => {
    signOut();
    await expectApiError(callService({ action: 'bootstrap' }), {
      status: 401,
      code: 'unauthenticated',
    });

    signInAs({ userId: 'user_without_org', orgId: null });
    await expectApiError(callService({ action: 'bootstrap' }), {
      status: 409,
      code: 'organization_required',
    });
  });
});
