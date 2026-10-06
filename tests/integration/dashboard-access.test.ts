import { eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';
import { createDatabase } from '#/db/client';
import { dashboardGrants, dataSources, libraryMetrics, shareLinks } from '#/db/schema';
import { yearToDateRange } from '#/domain/dates';
import { setClerkDirectory, signOut } from './doubles/clerk';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  newUserId,
  scorecardDefinition,
  seedDataSource,
  signInAsColleague,
  signInAsOwner,
  signInAsUser,
  signInToNewWorkspace,
} from './fixtures';

interface SharingState {
  links: Array<{ token: string; url: string; revokedAt: string | null }>;
  grants: Array<{ clerkUserId: string; role: string; userEmail?: string }>;
}

interface OpenedDashboard {
  role: string;
  sharing?: SharingState;
  dataSources: Array<{ id: string }>;
  dashboard: { pages: Array<{ widgets: Array<{ definition: { title?: string } }> }> };
}

describe('dashboard grants', () => {
  test('the creator keeps an editor grant and admins open every dashboard', async () => {
    const workspace = await signInToNewWorkspace();
    const dashboard = await createDashboard('Board review');

    const opened = (await callService({
      action: 'getDashboard',
      dashboardId: dashboard.id,
    })) as OpenedDashboard;
    expect(opened.role).toBe('admin');
    const refreshed = (await callService({
      action: 'getDashboard',
      dashboardId: dashboard.id,
      includeSharing: false,
    })) as OpenedDashboard;
    expect(refreshed.role).toBe('admin');
    expect(refreshed.dashboard).toEqual(opened.dashboard);
    expect(refreshed.sharing).toBeUndefined();
    expect(opened.sharing?.grants).toEqual([
      expect.objectContaining({ clerkUserId: workspace.userId, role: 'editor' }),
    ]);
  });

  test('deleting as an editor removes the dashboard, grants, and links while keeping datasources', async () => {
    const workspace = await signInToNewWorkspace({ isAdmin: false });
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard('Temporary report');
    await addWidget(dashboard.id, scorecardDefinition(source));
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'createLink' },
    })) as { token: string };
    expect(await callService({ action: 'bootstrap' })).toMatchObject({
      dashboards: [expect.objectContaining({ id: dashboard.id, canEdit: true })],
    });

    await callService({ action: 'deleteDashboard', dashboardId: dashboard.id });
    expect(await callService({ action: 'listDashboards' })).toEqual([]);
    await expectApiError(callService({ action: 'getDashboard', dashboardId: dashboard.id }), {
      status: 404,
      code: 'dashboard_not_found',
    });
    await expectApiError(callService({ action: 'getSharedDashboard', shareToken: link.token }), {
      status: 404,
      code: 'invalid_share_link',
    });
    const db = createDatabase(env.DB);
    expect(
      await db.select().from(dashboardGrants).where(eq(dashboardGrants.dashboardId, dashboard.id)),
    ).toEqual([]);
    expect(
      await db.select().from(shareLinks).where(eq(shareLinks.dashboardId, dashboard.id)),
    ).toEqual([]);
    expect(await db.select().from(dataSources).where(eq(dataSources.id, source.id))).toHaveLength(
      1,
    );
  });

  test('an admin in another workspace cannot delete a dashboard', async () => {
    const workspace = await signInToNewWorkspace();
    const dashboard = await createDashboard();
    await signInToNewWorkspace();
    await expectApiError(callService({ action: 'deleteDashboard', dashboardId: dashboard.id }), {
      status: 404,
      code: 'dashboard_not_found',
    });
    signInAsOwner(workspace);
    expect(await callService({ action: 'getDashboard', dashboardId: dashboard.id })).toMatchObject({
      dashboard: { id: dashboard.id },
    });
  });

  test('a colleague in the same workspace needs a grant', async () => {
    const workspace = await signInToNewWorkspace();
    const dashboard = await createDashboard();

    signInAsColleague(workspace);
    await expectApiError(callService({ action: 'getDashboard', dashboardId: dashboard.id }), {
      status: 403,
      code: 'dashboard_access_denied',
    });
    expect(await callService({ action: 'listDashboards' })).toEqual([]);
  });

  test('a viewer grant reads the dashboard but cannot change it', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const widget = await addWidget(dashboard.id, scorecardDefinition(source));

    const viewerId = newUserId();
    setClerkDirectory([{ id: viewerId, emailAddress: 'viewer@example.com' }]);
    await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'grant', userEmail: 'viewer@example.com', role: 'viewer' },
    });

    signInAsUser(workspace, viewerId);
    const opened = (await callService({
      action: 'getDashboard',
      dashboardId: dashboard.id,
    })) as OpenedDashboard;
    expect(opened.role).toBe('viewer');
    expect(await callService({ action: 'bootstrap' })).toMatchObject({
      dashboards: [expect.objectContaining({ id: dashboard.id, canEdit: false })],
    });
    await expectApiError(callService({ action: 'deleteDashboard', dashboardId: dashboard.id }), {
      status: 403,
      code: 'dashboard_access_denied',
    });
    // Sharing state stays hidden from viewers.
    expect(opened.sharing).toBeUndefined();
    expect((await callService({ action: 'listDashboards' })) as unknown[]).toHaveLength(1);

    await expectApiError(
      callService({
        action: 'updateWidget',
        dashboardId: dashboard.id,
        widgetId: widget.id,
        definition: scorecardDefinition(source),
      }),
      { status: 403, code: 'dashboard_access_denied' },
    );
  });

  test('an editor grant can change widgets and a revoked grant loses access', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const widget = await addWidget(dashboard.id, scorecardDefinition(source));

    const editorId = newUserId();
    setClerkDirectory([{ id: editorId, emailAddress: 'editor@example.com', firstName: 'Edith' }]);
    const shared = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'grant', userEmail: 'editor@example.com', role: 'editor' },
    })) as SharingState;
    expect(shared.grants).toContainEqual(
      expect.objectContaining({
        clerkUserId: editorId,
        role: 'editor',
        userEmail: 'editor@example.com',
        displayName: 'Edith',
      }),
    );

    signInAsUser(workspace, editorId);
    await callService({
      action: 'updateWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      definition: { ...scorecardDefinition(source), title: 'Revenue, revised' },
    });
    const afterEdit = (await callService({
      action: 'getDashboard',
      dashboardId: dashboard.id,
    })) as OpenedDashboard;
    expect(afterEdit.dashboard.pages[0].widgets[0].definition.title).toBe('Revenue, revised');

    signInAsOwner(workspace);
    await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'revoke', userId: editorId },
    });

    signInAsUser(workspace, editorId);
    await expectApiError(callService({ action: 'getDashboard', dashboardId: dashboard.id }), {
      status: 403,
      code: 'dashboard_access_denied',
    });
  });
});

describe('widget updates', () => {
  test('rolls back the widget when its library metric cannot be created', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard();
    const widget = await addWidget(dashboard.id, scorecardDefinition(source));
    const database = createDatabase(env.DB);
    await database.insert(libraryMetrics).values({
      id: 'existing_metric',
      workspaceId: workspace.workspaceId,
      name: 'Existing metric',
      canonicalName: 'cost_per_view',
      expression: 'sum(revenue)',
      semanticType: 'count',
      description: null,
      updatedAt: new Date().toISOString(),
    });

    const error = await callService({
      action: 'updateWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      definition: {
        ...scorecardDefinition(source),
        title: 'Cost per view',
        metric: {
          source: { kind: 'expression', expression: 'sum(revenue)' },
          dataType: 'number',
        },
      },
      libraryMetric: {
        name: 'Cost per view',
        canonicalName: 'cost_per_view',
        expression: 'sum(revenue)',
        semanticType: 'count',
      },
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);

    const opened = (await callService({
      action: 'getDashboard',
      dashboardId: dashboard.id,
    })) as OpenedDashboard;
    expect(opened.dashboard.pages[0].widgets[0].definition.title).toBe('Revenue');
    expect(
      await database
        .select()
        .from(libraryMetrics)
        .where(eq(libraryMetrics.workspaceId, workspace.workspaceId)),
    ).toHaveLength(1);
  });
});

describe('share links', () => {
  test('a link opens the dashboard read-only without a session', async () => {
    const workspace = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const dashboard = await createDashboard('Client report');
    await addWidget(dashboard.id, scorecardDefinition(source));
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'createLink' },
    })) as { token: string; url: string };
    expect(link.url).toBe(`/share/${link.token}`);

    signOut();
    const shared = (await callService({
      action: 'getSharedDashboard',
      shareToken: link.token,
    })) as OpenedDashboard;
    expect(shared.role).toBe('viewer');
    expect(shared.sharing).toBeUndefined();
    // Viewers only learn about the datasources their widgets already reference.
    expect(shared.dataSources.map((entry) => entry.id)).toEqual([source.id]);
  });

  test('a revoked link stops working', async () => {
    await signInToNewWorkspace();
    const dashboard = await createDashboard();
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'createLink' },
    })) as { token: string };
    await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'revokeLink', token: link.token },
    });

    signOut();
    await expectApiError(callService({ action: 'getSharedDashboard', shareToken: link.token }), {
      status: 404,
      code: 'invalid_share_link',
    });
    await expectApiError(
      callService({ action: 'getDashboard', dashboardId: dashboard.id, shareToken: link.token }),
      { status: 403, code: 'invalid_share_link' },
    );
  });

  test('a link cannot be pointed at a different dashboard', async () => {
    await signInToNewWorkspace();
    const shareable = await createDashboard('Shareable');
    const unshared = await createDashboard('Unshared');
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: shareable.id,
      operation: { kind: 'createLink' },
    })) as { token: string };

    signOut();
    await expectApiError(
      callService({ action: 'getDashboard', dashboardId: unshared.id, shareToken: link.token }),
      { status: 403, code: 'invalid_share_link' },
    );
  });
});

describe('date controls', () => {
  test('a dashboard accepts only one date control across add and update operations', async () => {
    await signInToNewWorkspace();
    const dashboard = await createDashboard();
    const dateControl = await addWidget(dashboard.id, { type: 'dateControl' });
    const opened = (await callService({
      action: 'getDashboard',
      dashboardId: dashboard.id,
    })) as { dashboard: { pages: Array<{ widgets: Array<{ id: string; definition: unknown }> }> } };
    expect(
      opened.dashboard.pages[0].widgets.find((widget) => widget.id === dateControl.id),
    ).toMatchObject({
      definition: { type: 'dateControl', defaultDateRange: yearToDateRange },
    });

    await expectApiError(addWidget(dashboard.id, { type: 'dateControl' }), {
      status: 400,
      code: 'date_control_exists',
    });

    const text = await addWidget(dashboard.id, {
      type: 'text',
      content: { schemaVersion: 'plain-text-v1', document: 'Notes' },
    });
    await expectApiError(
      callService({
        action: 'updateWidget',
        dashboardId: dashboard.id,
        widgetId: text.id,
        definition: { type: 'dateControl' },
      }),
      { status: 400, code: 'date_control_exists' },
    );

    await expect(
      callService({
        action: 'updateWidget',
        dashboardId: dashboard.id,
        widgetId: dateControl.id,
        definition: { type: 'dateControl' },
      }),
    ).resolves.toMatchObject({ widget: { id: dateControl.id } });
  });
});
