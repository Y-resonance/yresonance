import { useEffect, useRef } from 'react';
import { callApi } from '#/api/client';
import { useApiQuery } from '#/api/query';
import { useDashboardQueryRefresh } from './dashboard-query-refresh';

/**
 * "Data available through 28.10." in the dashboard header, for editors, viewers, and share links.
 * Covers the widgets on the shown page. `version` re-reads the date when the dashboard document
 * changes; the refresh button bypasses the server cache like it does for widgets.
 */
export function DataAvailability({
  dashboardId,
  pageId,
  shareToken,
  version,
}: {
  dashboardId: string;
  pageId?: string;
  shareToken?: string;
  version?: string;
}) {
  const { revision, inputsRevision, changePending } = useDashboardQueryRefresh();
  const refreshed = useRef(revision);
  const request = { action: 'getDataAvailability', dashboardId, pageId, shareToken } as const;
  const query = useApiQuery<{ through: string | null }>(request, {
    revision: [revision, inputsRevision, version],
    queryFn: async (signal) => {
      const result = await callApi<{ through: string | null }>(
        { ...request, refresh: revision !== refreshed.current },
        { signal },
      );
      refreshed.current = revision;
      return result;
    },
  });
  useEffect(() => {
    if (!query.isFetching) return;
    changePending(1);
    return () => changePending(-1);
  }, [query.isFetching, changePending]);
  const through = query.data?.through;
  if (!through) return null;
  return (
    <span className="text-sm whitespace-nowrap text-muted-foreground">
      Data available through {formatThrough(through)}
    </span>
  );
}

// Day and month in the visitor's locale ("28.10." in German), with the year only when it differs.
function formatThrough(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year!, month! - 1, day);
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: '2-digit',
    ...(year === new Date().getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}
