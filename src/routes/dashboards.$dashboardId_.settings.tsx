import { createFileRoute, Link, Navigate, useBlocker } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';
import { useApi } from '#/api/query';
import { AppShell } from '#/components/app-shell';
import { ThemeSettings } from '#/components/dashboard-builder/appearance-settings';
import { useDashboardPayload } from '#/components/dashboard-payload';
import { ErrorState, LoadingState } from '#/components/request-state';
import { SaveStatusIndicator } from '#/components/save-status-indicator';
import { Alert, AlertDescription } from '#/components/ui/alert';
import { buttonVariants } from '#/components/ui/button';
import type { DashboardTheme } from '#/domain/schema';
import { createSerialQueue } from '#/domain/serial-queue';
import { pageTitle, usePageTitle } from '#/lib/page-title';
import { cn } from '#/lib/utils';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';

export const Route = createFileRoute('/dashboards/$dashboardId_/settings')({
  // The dashboard page the settings were opened from, so going back returns to it.
  validateSearch: z.object({ page: z.string().optional().catch(undefined) }),
  component: DashboardSettingsPage,
  head: () => ({
    meta: [
      { title: pageTitle('Dashboard settings') },
      { name: 'description', content: 'Set the theme of a yresonance dashboard.' },
    ],
  }),
});

function DashboardSettingsPage() {
  return (
    <AppShell requireWorkspace>
      <DashboardSettingsContent />
    </AppShell>
  );
}

function DashboardSettingsContent() {
  const callApi = useApi();
  const { dashboardId } = Route.useParams();
  const { page } = Route.useSearch();
  const dashboardQuery = useDashboardPayload(dashboardId);
  const { data: payload, setData, cancel, refetch } = dashboardQuery;
  const [error, setError] = useState<string>();
  const [pendingSaves, setPendingSaves] = useState(0);
  const saveQueue = useRef(createSerialQueue());
  const saving = useRef(0);
  const saveFailed = useRef(false);
  const latestEdit = useRef(0);
  const savedTheme = useRef<DashboardTheme>(undefined);
  const canEdit = payload?.role === 'admin' || payload?.role === 'editor';
  // A read while a save is running could return the theme from before it. The refresh that follows
  // the last save also shows what the tool changed.
  const refreshAfterTool = useCallback(() => {
    if (!saving.current) void refetch();
  }, [refetch]);
  // Leaving waits for running saves. The dashboard page then reads them, and the builder, which resets
  // from the cache this page writes to, can't lose an edit to a save finishing behind it. If the last
  // save failed, the user stays here to see why.
  const waitForSaves = useCallback(async () => {
    if (!saving.current) return false;
    while (saving.current) await saveQueue.current(() => Promise.resolve());
    return saveFailed.current;
  }, []);
  const hasRunningSave = useCallback(() => saving.current > 0, []);
  useBlocker({ shouldBlockFn: waitForSaves, enableBeforeUnload: hasRunningSave });
  usePageTitle(payload ? `${payload.dashboard.name} settings` : 'Dashboard settings');
  useWebMcpTools({
    dashboardId,
    canCreate: Boolean(payload),
    canEdit,
    isAdmin: payload?.role === 'admin',
    onMutation: refreshAfterTool,
  });

  function storeTheme(theme: DashboardTheme | undefined) {
    setData((current) => current && { ...current, dashboard: { ...current.dashboard, theme } });
  }

  // Saves run in edit order and each holds the whole theme. A read still running predates this edit,
  // and the next edit is built from what it would show, so it is cancelled first.
  async function updateTheme(theme: DashboardTheme) {
    const edit = ++latestEdit.current;
    // With nothing saving, the form shows what the server has.
    if (!saving.current) savedTheme.current = payload?.dashboard.theme;
    saving.current += 1;
    await cancel();
    storeTheme(theme);
    setPendingSaves((current) => current + 1);
    setError(undefined);
    try {
      await saveQueue.current(() => callApi({ action: 'updateDashboard', dashboardId, theme }));
      savedTheme.current = theme;
      saveFailed.current = false;
      // This save also stored whatever an earlier failure lost.
      setError(undefined);
    } catch (caught) {
      saveFailed.current = true;
      // A later edit still saving contains this one, so only the newest failure undoes anything.
      if (edit === latestEdit.current) storeTheme(savedTheme.current);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPendingSaves((current) => current - 1);
      // Replaces any read cancelled above, and the server's answer can't predate these saves.
      if (--saving.current === 0) void refetch();
    }
  }

  // A failed background refresh must not take the form away, only a load with nothing to show.
  if (!payload)
    return dashboardQuery.error ? (
      <ErrorState error={dashboardQuery.error.message} />
    ) : (
      <LoadingState />
    );
  if (!canEdit) return <Navigate to="/dashboards/$dashboardId" params={{ dashboardId }} replace />;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6">
      <div>
        <Link
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 max-w-full')}
          to="/dashboards/$dashboardId"
          params={{ dashboardId }}
          search={{ page }}
        >
          <ArrowLeftIcon />
          <span className="truncate">{payload.dashboard.name}</span>
        </Link>
        <header className="mt-3 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <SaveStatusIndicator status={pendingSaves ? 'saving' : error ? 'error' : 'saved'} />
        </header>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ThemeSettings
        theme={payload.dashboard.theme}
        onChange={(theme) => void updateTheme(theme)}
      />
    </main>
  );
}
