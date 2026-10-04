import { describe, expect, test } from 'vitest';
import type { DashboardDocument, DashboardWidget } from '#/domain/schema';
import { signOut } from './doubles/clerk';
import { queryEngine } from './doubles/query-engine';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  regionControlDefinition,
  scorecardDefinition,
  seedDataSource,
  signInToNewWorkspace,
} from './fixtures';

async function openDashboard(dashboardId: string) {
  return (await callService({ action: 'getDashboard', dashboardId })) as {
    dashboard: DashboardDocument;
  };
}

async function addPage(dashboardId: string, name: string, hidden = false) {
  const dashboard = (await callService({
    action: 'addPage',
    dashboardId,
    name,
    hidden,
  })) as DashboardDocument;
  return dashboard.pages.at(-1)!;
}

const text = { type: 'text', content: { schemaVersion: 'plain', document: 'Report' } };

describe('dashboard pages', () => {
  test('page edits persist, widget moves and copies stay within their target canvas, and deletion needs confirmation', async () => {
    await signInToNewWorkspace();
    const dashboard = await createDashboard();
    const overview = dashboard.pages[0];
    const widget = await addWidget(dashboard.id, {
      type: 'text',
      content: { schemaVersion: 'plain', document: 'Report' },
    });
    const channels = await addPage(dashboard.id, 'Channels');
    const drafts = await addPage(dashboard.id, 'Draft', true);
    await callService({
      action: 'updatePage',
      dashboardId: dashboard.id,
      pageId: channels.id,
      name: 'Delivery',
      position: 0,
    });
    expect((await openDashboard(dashboard.id)).dashboard.pages.map((page) => page.name)).toEqual([
      'Delivery',
      'Overview',
      'Draft',
    ]);

    await callService({
      action: 'moveWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      pageId: channels.id,
      placement: { x: 0, y: 0, width: 4, height: 3 },
    });
    const copy = (await callService({
      action: 'copyWidget',
      dashboardId: dashboard.id,
      fromDashboardId: dashboard.id,
      pageId: drafts.id,
      widgetId: widget.id,
    })) as { widget: DashboardWidget };
    let saved = (await openDashboard(dashboard.id)).dashboard;
    expect(saved.pages.find((page) => page.id === overview.id)?.widgets).toEqual([]);
    expect(saved.pages[0].widgets.map((item) => item.id)).toEqual([widget.id]);
    expect(saved.pages[2].widgets[0]).toMatchObject({ id: copy.widget.id, definition: text });

    await expectApiError(
      callService({
        action: 'updateLayout',
        dashboardId: dashboard.id,
        pageId: channels.id,
        canvasRows: 10,
        placements: [{ widgetId: copy.widget.id, placement: { x: 0, y: 0, width: 4, height: 3 } }],
      }),
      { status: 400, code: 'invalid_layout' },
    );
    await expectApiError(
      callService({ action: 'removePage', dashboardId: dashboard.id, pageId: channels.id }),
      { status: 400, code: 'page_confirmation_required' },
    );
    expect((await openDashboard(dashboard.id)).dashboard.pages).toHaveLength(3);
    await callService({
      action: 'removePage',
      dashboardId: dashboard.id,
      pageId: channels.id,
      confirm: true,
    });
    await callService({ action: 'removePage', dashboardId: dashboard.id, pageId: overview.id });
    saved = (await openDashboard(dashboard.id)).dashboard;
    expect(saved.pages.map((page) => page.id)).toEqual([drafts.id]);
    await expectApiError(
      callService({
        action: 'removePage',
        dashboardId: dashboard.id,
        pageId: drafts.id,
        confirm: true,
      }),
      { status: 400, code: 'page_required' },
    );
  });

  test('shared viewers see all published pages but cannot access draft widgets, controls, datasources, or mutations', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const draft = await addPage(dashboard.id, 'Draft', true);
    const chart = (await callService({
      action: 'addWidget',
      dashboardId: dashboard.id,
      pageId: draft.id,
      definition: scorecardDefinition(source),
      width: 4,
      height: 3,
    })) as { widget: DashboardWidget };
    const control = (await callService({
      action: 'addWidget',
      dashboardId: dashboard.id,
      pageId: draft.id,
      definition: regionControlDefinition(source),
      width: 4,
      height: 3,
    })) as { widget: DashboardWidget };
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'createLink' },
    })) as { token: string };
    signOut();
    const opened = (await callService({
      action: 'getSharedDashboard',
      shareToken: link.token,
    })) as { dashboard: DashboardDocument; dataSources: unknown[] };
    expect(opened.dashboard.pages.map((page) => page.id)).toEqual([dashboard.pages[0].id]);
    expect(opened.dataSources).toEqual([]);
    const ref = { dashboardId: dashboard.id, shareToken: link.token };
    for (const action of ['queryWidget', 'explainWidget'])
      await expectApiError(callService({ action, ...ref, widgetId: chart.widget.id }), {
        status: 404,
        code: 'widget_not_found',
      });
    await expectApiError(
      callService({ action: 'getControlOptions', ...ref, controlId: control.widget.id }),
      { status: 404, code: 'widget_not_found' },
    );
    await expectApiError(
      callService({ action: 'describeDatasource', ...ref, dataSourceId: source.id }),
      { status: 403, code: 'datasource_access_denied' },
    );
    await expectApiError(callService({ action: 'trackPageView', ...ref, pageId: draft.id }), {
      status: 404,
      code: 'page_not_found',
    });
    await expectApiError(callService({ action: 'addPage', ...ref, name: 'Unauthorized' }), {
      status: 401,
      code: 'unauthenticated',
    });
  });

  test('controls apply across pages by canonical name and draft controls do not filter published widgets', async () => {
    const workspace = await signInToNewWorkspace();
    const first = await seedDataSource(workspace);
    const second = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const control = await addWidget(
      dashboard.id,
      regionControlDefinition(first, { defaultValues: ['EMEA'] }),
    );
    const page = await addPage(dashboard.id, 'Channels');
    const chart = (await callService({
      action: 'addWidget',
      dashboardId: dashboard.id,
      pageId: page.id,
      definition: scorecardDefinition(second),
      width: 4,
      height: 3,
    })) as { widget: DashboardWidget };
    queryEngine.reset();
    await callService({
      action: 'queryWidget',
      dashboardId: dashboard.id,
      widgetId: chart.widget.id,
      controlState: { values: { [control.id]: ['APAC'] } },
    });
    expect(queryEngine.queryCalls.at(-1)?.parameters).toContain('APAC');
    expect(queryEngine.queryCalls.at(-1)?.sql).toContain('region');
    await callService({
      action: 'updatePage',
      dashboardId: dashboard.id,
      pageId: dashboard.pages[0].id,
      hidden: true,
    });
    queryEngine.reset();
    await callService({
      action: 'queryWidget',
      dashboardId: dashboard.id,
      widgetId: chart.widget.id,
      controlState: { values: { [control.id]: ['APAC'] } },
    });
    expect(queryEngine.queryCalls.at(-1)?.parameters).not.toContain('APAC');
    expect(queryEngine.queryCalls.at(-1)?.parameters).not.toContain('EMEA');
    await callService({
      action: 'updatePage',
      dashboardId: dashboard.id,
      pageId: page.id,
      hidden: true,
    });
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'createLink' },
    })) as { token: string };
    signOut();
    expect(
      await callService({ action: 'getSharedDashboard', shareToken: link.token }),
    ).toMatchObject({ dashboard: { pages: [] }, controlState: {} });
  });
});
