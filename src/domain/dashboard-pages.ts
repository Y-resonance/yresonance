import type { DashboardDocument, DashboardPage } from './schema';

export function activeDashboardPage(dashboard: DashboardDocument, pageId?: string) {
  return dashboard.pages.find((page) => page.id === pageId) ?? dashboard.pages[0];
}

export type DashboardCanvas = DashboardDocument & Pick<DashboardPage, 'widgets' | 'canvasRows'>;

// The canvas edits one page; controls and metadata still belong to the full dashboard.
export function dashboardCanvas(dashboard: DashboardDocument, pageId: string): DashboardCanvas {
  const page = activeDashboardPage(dashboard, pageId)!;
  return { ...dashboard, widgets: page.widgets, canvasRows: page.canvasRows };
}
