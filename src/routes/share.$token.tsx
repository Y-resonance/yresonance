import {
  DashboardQueryRefresh,
  DashboardRefreshButton,
} from '#/components/dashboard-query-refresh';
import { DashboardPages } from '#/components/dashboard-pages';
import { activeDashboardPage } from '#/domain/dashboard-pages';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { callApi } from '#/api/client';
import { DashboardView, dashboardDateControlRange } from '#/components/dashboard-view';
import { ErrorState, LoadingState } from '#/components/request-state';
import {
  dateRangeSearchValue,
  parseDateRangeSearch,
  sameDateRange,
} from '#/domain/date-range-search';
import type { DashboardDocument } from '#/domain/schema';
import { pageTitle, usePageTitle } from '#/lib/page-title';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';

export const Route = createFileRoute('/share/$token')({
  validateSearch: z.object({
    page: z.string().optional().catch(undefined),
    dateRange: z.string().optional().catch(undefined),
  }),
  component: SharedDashboard,
  head: () => ({
    meta: [
      { title: pageTitle('Shared dashboard') },
      {
        name: 'description',
        content: 'View a shared yresonance report and explore its charts, tables and filters.',
      },
    ],
  }),
});

function SharedDashboard() {
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [dashboard, setDashboard] = useState<DashboardDocument>();
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    try {
      const result = await callApi<{ dashboard: DashboardDocument }>({
        action: 'getSharedDashboard',
        shareToken: token,
      });
      setDashboard(result.dashboard);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  usePageTitle(dashboard?.name ?? 'Shared dashboard');
  useWebMcpTools({ dashboardId: dashboard?.id, shareToken: token });
  // The main width matches the signed-in dashboard, so an editor previewing viewer mode sees
  // what a share-link recipient gets.
  return (
    <DashboardQueryRefresh key={token}>
      <main className="mx-auto min-h-screen w-full max-w-[100rem] px-4 py-6 sm:px-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">yresonance</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {dashboard?.name ?? 'Shared dashboard'}
            </h1>
          </div>
          {dashboard ? <DashboardRefreshButton /> : null}
        </header>
        {error ? (
          <ErrorState error={error} />
        ) : !dashboard ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col gap-4">
            <DashboardPages
              dashboard={dashboard}
              pageId={search.page}
              shareToken={token}
              onPageChange={(page) =>
                void navigate({ search: (current) => ({ ...current, page }) })
              }
            />
            <DashboardView
              pageId={activeDashboardPage(dashboard, search.page)?.id}
              dashboard={dashboard}
              shareToken={token}
              dateRange={parseDateRangeSearch(search.dateRange)}
              onDateRangeChange={(range) => {
                const defaultRange = dashboardDateControlRange(dashboard);
                void navigate({
                  search: (current) => ({
                    ...current,
                    dateRange:
                      defaultRange && sameDateRange(defaultRange, range)
                        ? undefined
                        : dateRangeSearchValue(range),
                  }),
                });
              }}
            />
          </div>
        )}
      </main>
    </DashboardQueryRefresh>
  );
}
