import { useApiQuery } from '#/api/query';
import type { BuilderDataSource } from '#/components/dashboard-builder';
import type { SharingState } from '#/components/dashboard-sharing';
import type { DashboardDocument } from '#/domain/schema';

export interface DashboardPayload {
  dashboard: DashboardDocument;
  role: 'admin' | 'editor' | 'viewer';
  dataSources: BuilderDataSource[];
  sharing?: SharingState;
}

/** The dashboard and settings pages share this cache entry, so an edit on one shows on the other. */
export function useDashboardPayload(dashboardId: string) {
  return useApiQuery<DashboardPayload>({
    action: 'getDashboard',
    dashboardId,
    includeSharing: true,
  });
}
