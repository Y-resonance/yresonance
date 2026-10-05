import { eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';
import { createDatabase } from '#/db/client';
import { dashboardGrants, fields, shareLinks } from '#/db/schema';
import type { DashboardDocument } from '#/domain/schema';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  regionControlDefinition,
  scorecardDefinition,
  seedDataSource,
  signInAsColleague,
  signInAsOwner,
  signInToNewWorkspace,
  type SeededDataSource,
} from './fixtures';

async function reportFor(source: SeededDataSource) {
  const dashboard = await createDashboard('Client A report');
  const scorecard = await addWidget(dashboard.id, scorecardDefinition(source));
  const control = await addWidget(
    dashboard.id,
    regionControlDefinition(source, { defaultValues: ['North'] }),
  );
  await callService({
    action: 'shareDashboard',
    dashboardId: dashboard.id,
    operation: { kind: 'createLink' },
  });
  return { dashboard, scorecard, control };
}

function duplicate(dashboardId: string, dataSourceMapping?: Record<string, string>) {
  return callService({
    action: 'duplicateDashboard',
    dashboardId,
    name: 'Client B report',
    dataSourceMapping,
  }) as Promise<DashboardDocument>;
}

describe('duplicating dashboards', () => {
  test('a plain copy keeps widgets and layout but not access', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const { dashboard } = await reportFor(source);
    const withDraft = (await callService({
      action: 'addPage',
      dashboardId: dashboard.id,
      name: 'Draft',
      hidden: true,
    })) as DashboardDocument;
    await callService({
      action: 'addWidget',
      dashboardId: dashboard.id,
      pageId: withDraft.pages.at(-1)!.id,
      definition: { type: 'text', content: { schemaVersion: 'plain', document: 'Draft notes' } },
      width: 6,
      height: 3,
    });
    signInAsColleague(workspace);
    await expectApiError(duplicate(dashboard.id), {
      status: 403,
      code: 'dashboard_access_denied',
    });
    signInAsOwner(workspace);
    const { dashboard: original } = (await callService({
      action: 'getDashboard',
      dashboardId: dashboard.id,
    })) as { dashboard: DashboardDocument };

    const copy = await duplicate(dashboard.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Client B report');
    expect(
      copy.pages.map((page) => ({
        name: page.name,
        hidden: page.hidden,
        canvasRows: page.canvasRows,
        widgets: page.widgets.map((widget) => ({
          definition: widget.definition,
          layout: widget.layout,
        })),
      })),
    ).toEqual(
      original.pages.map((page) => ({
        name: page.name,
        hidden: page.hidden,
        canvasRows: page.canvasRows,
        widgets: page.widgets.map((widget) => ({
          definition: widget.definition,
          layout: widget.layout,
        })),
      })),
    );
    expect(
      copy.pages.map((page) => page.id).some((id) => original.pages.some((page) => page.id === id)),
    ).toBe(false);
    expect(
      copy.pages
        .flatMap((page) => page.widgets)
        .map((widget) => widget.id)
        .some((id) =>
          original.pages.flatMap((page) => page.widgets).some((widget) => widget.id === id),
        ),
    ).toBe(false);
    expect(copy.createdBy).toBe(workspace.userId);
    expect(copy.pages[0].widgets.map((widget) => widget.definition)).toEqual(
      original.pages[0].widgets.map((widget) => widget.definition),
    );
    expect(copy.pages[0].widgets.map((widget) => widget.layout)).toEqual(
      original.pages[0].widgets.map((widget) => widget.layout),
    );
    expect(copy.pages[0].widgets.map((widget) => widget.id)).not.toContain(
      original.pages[0].widgets[0]!.id,
    );
    const db = createDatabase(env.DB);
    expect(await db.select().from(shareLinks).where(eq(shareLinks.dashboardId, copy.id))).toEqual(
      [],
    );
    expect(
      await db.select().from(dashboardGrants).where(eq(dashboardGrants.dashboardId, copy.id)),
    ).toEqual([expect.objectContaining({ clerkUserId: workspace.userId, role: 'editor' })]);
  });

  test('a mapping points every widget at the target datasource by canonical name', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const target = await seedDataSource(workspace);
    const { dashboard, scorecard: originalScorecard } = await reportFor(source);
    const withPage = (await callService({
      action: 'addPage',
      dashboardId: dashboard.id,
      name: 'Delivery',
    })) as DashboardDocument;
    await callService({
      action: 'moveWidget',
      dashboardId: dashboard.id,
      widgetId: originalScorecard.id,
      pageId: withPage.pages.at(-1)!.id,
      placement: { x: 0, y: 0, width: 4, height: 3 },
    });

    const copy = await duplicate(dashboard.id, { [source.id]: target.id });

    const scorecard = copy.pages[1].widgets[0].definition;
    const control = copy.pages[0].widgets[0].definition;
    expect(scorecard).toMatchObject({
      dataSourceId: target.id,
      dateRangeFieldId: target.fieldIds.day,
      metric: { source: { fieldId: target.fieldIds.revenue } },
    });
    expect(control).toMatchObject({ dataSourceId: target.id, fieldId: target.fieldIds.region });
    expect(control).not.toHaveProperty('defaultValues', ['North']);
  });

  test('unmatched fields fail the copy and are listed per widget', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const target = await seedDataSource(workspace);
    const { dashboard, scorecard, control } = await reportFor(source);
    const db = createDatabase(env.DB);
    for (const [id, canonicalName] of [
      [target.fieldIds.region, 'territory'],
      [target.fieldIds.revenue, 'gross_revenue'],
    ])
      await db.update(fields).set({ canonicalName }).where(eq(fields.id, id));

    const error = await expectApiError(duplicate(dashboard.id, { [source.id]: target.id }), {
      status: 400,
      code: 'canonical_field_missing',
    });

    expect(error.issues).toEqual([
      { widgetId: scorecard.id, widget: 'Revenue', canonicalNames: ['revenue'] },
      { widgetId: control.id, widget: 'Filter', canonicalNames: ['region'] },
    ]);
    expect(error.message).toContain('Revenue');
    expect(await callService({ action: 'listDashboards' })).toHaveLength(1);
  });

  test('rejects a mapping for a datasource the dashboard does not use', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const unused = await seedDataSource(workspace);
    const { dashboard } = await reportFor(source);

    await expectApiError(duplicate(dashboard.id, { [unused.id]: source.id }), {
      status: 400,
      code: 'invalid_datasource',
    });
  });
});
