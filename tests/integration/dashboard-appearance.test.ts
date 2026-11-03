import { describe, expect, test } from 'vitest';
import type { DashboardDocument, WidgetDefinition } from '#/domain/schema';
import { signOut } from './doubles/clerk';
import { addWidget, callService, createDashboard, signInToNewWorkspace } from './fixtures';

const text: WidgetDefinition = {
  type: 'text',
  content: { schemaVersion: 'plain', document: 'Summary' },
};

describe('dashboard appearance', () => {
  test('an agent sets a brand theme and styles one widget, and share links receive both', async () => {
    await signInToNewWorkspace();
    const dashboard = await createDashboard('Client report');
    const styled = await addWidget(dashboard.id, text);
    const plain = await addWidget(dashboard.id, text);
    const theme = {
      brandColor: '#7c3aed',
      chartPalette: 'brand',
      widgetDefaults: { borderWidth: 0, shadow: true },
    } as const;

    const updated = (await callService({
      action: 'updateDashboard',
      dashboardId: dashboard.id,
      theme,
    })) as DashboardDocument;
    expect(updated.theme).toEqual(theme);
    // Other dashboard settings are kept when only the theme changes.
    expect(updated.name).toBe('Client report');
    await callService({
      action: 'updateWidget',
      dashboardId: dashboard.id,
      widgetId: styled.id,
      definition: { ...text, appearance: { background: 'theme:brand', backgroundOpacity: 10 } },
    });

    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'createLink' },
    })) as { token: string };
    signOut();
    const shared = (await callService({
      action: 'getSharedDashboard',
      shareToken: link.token,
    })) as { dashboard: DashboardDocument };
    const widgets = shared.dashboard.pages[0]!.widgets;
    expect(shared.dashboard.theme).toEqual(theme);
    expect(widgets.find((widget) => widget.id === styled.id)?.definition.appearance).toEqual({
      background: 'theme:brand',
      backgroundOpacity: 10,
    });
    expect(widgets.find((widget) => widget.id === plain.id)?.definition.appearance).toBeUndefined();
  });

  test('an empty theme clears the stored one', async () => {
    await signInToNewWorkspace();
    const dashboard = await createDashboard();
    await callService({
      action: 'updateDashboard',
      dashboardId: dashboard.id,
      theme: { canvasBackground: 'theme:muted' },
    });

    const cleared = (await callService({
      action: 'updateDashboard',
      dashboardId: dashboard.id,
      theme: {},
    })) as DashboardDocument;
    expect(cleared.theme).toEqual({});
  });
});
