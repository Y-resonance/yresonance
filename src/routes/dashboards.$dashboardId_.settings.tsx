import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
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
  const { data: payload, setData, refetch } = dashboardQuery;
  const [error, setError] = useState<string>();
  const [pendingSaves, setPendingSaves] = useState(0);
  const saveQueue = useRef(createSerialQueue());
  const canEdit = payload?.role === 'admin' || payload?.role === 'editor';
  const refreshAfterTool = useCallback(() => void refetch(), [refetch]);
  usePageTitle(payload ? `${payload.dashboard.name} settings` : 'Dashboard settings');
  useWebMcpTools({
    dashboardId,
    canCreate: Boolean(payload),
    canEdit,
    isAdmin: payload?.role === 'admin',
    onMutation: refreshAfterTool,
  });

  function storeTheme(theme: DashboardTheme | undefined, onlyIfThemeIs?: DashboardTheme) {
    setData((current) =>
      current && (onlyIfThemeIs === undefined || current.dashboard.theme === onlyIfThemeIs)
        ? { ...current, dashboard: { ...current.dashboard, theme } }
        : current,
    );
  }

  // Saves run in edit order and the page keeps its own edit, so no refresh can overwrite a newer
  // one. The dashboard page reads the shared cache and refetches when it opens.
  async function updateTheme(theme: DashboardTheme) {
    const previous = payload?.dashboard.theme;
    storeTheme(theme);
    setPendingSaves((current) => current + 1);
    setError(undefined);
    try {
      await saveQueue.current(() => callApi({ action: 'updateDashboard', dashboardId, theme }));
    } catch (caught) {
      // Only undo when no later edit has replaced this one in the meantime.
      storeTheme(previous, theme);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPendingSaves((current) => current - 1);
    }
  }

  if (dashboardQuery.error) return <ErrorState error={dashboardQuery.error.message} />;
  if (!payload) return <LoadingState />;
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
