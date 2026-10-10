import {
  DashboardQueryRefresh,
  DashboardRefreshButton,
} from '#/components/dashboard-query-refresh';
import { DashboardPages } from '#/components/dashboard-pages';
import { dashboardWidgets } from '#/domain/schema';
import { activeDashboardPage } from '#/domain/dashboard-pages';
import { createFileRoute } from '@tanstack/react-router';
import { CloudAlertIcon, CloudCheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { z } from 'zod';
import { useApi, useApiQuery } from '#/api/query';
import { AppShell } from '#/components/app-shell';
import {
  DashboardBuilder,
  type BuilderDataSource,
  type DashboardSaveStatus,
} from '#/components/dashboard-builder';
import { DashboardSharing, type SharingState } from '#/components/dashboard-sharing';
import {
  DashboardView,
  dashboardDateControlRange,
  initialControlState,
} from '#/components/dashboard-view';
import { DuplicateDashboard } from '#/components/duplicate-dashboard';
import { ErrorState, LoadingState } from '#/components/request-state';
import { Label } from '#/components/ui/label';
import { Switch } from '#/components/ui/switch';
import {
  dateRangeSearchValue,
  parseDateRangeSearch,
  sameDateRange,
} from '#/domain/date-range-search';
import {
  activateAgentModeFromToolUse,
  initialAgentModeState,
  selectAgentMode,
} from '#/domain/agent-mode';
import type { ControlState, DashboardDocument } from '#/domain/schema';
import { pageTitle, usePageTitle } from '#/lib/page-title';
import { useWebMcpTools } from '#/webmcp/use-webmcp-tools';

export const Route = createFileRoute('/dashboards/$dashboardId')({
  validateSearch: z.object({
    page: z.string().optional().catch(undefined),
    dateRange: z.string().optional().catch(undefined),
    // Editors can preview the dashboard the way a viewer sees it. It lives in the URL so a
    // reload keeps the preview and the state is shareable while checking a viewer report.
    preview: z.literal('viewer').optional().catch(undefined),
  }),
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: pageTitle('Dashboard') },
      {
        name: 'description',
        content:
          'View and edit dashboard charts, formulas, filters and sharing settings in yresonance.',
      },
    ],
  }),
});

interface DashboardPayload {
  dashboard: DashboardDocument;
  role: 'admin' | 'editor' | 'viewer';
  dataSources: BuilderDataSource[];
  sharing?: SharingState;
}

function DashboardPage() {
  return (
    <AppShell requireWorkspace>
      <DashboardContent />
    </AppShell>
  );
}

function DashboardContent() {
  const callApi = useApi();
  const { dashboardId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const dashboardQuery = useApiQuery<DashboardPayload>({
    action: 'getDashboard',
    dashboardId,
    includeSharing: true,
  });
  const payload = dashboardQuery.data;
  const [builderControlState, setBuilderControlState] = useState<ControlState>({});
  const controlDashboardIdRef = useRef<string>(undefined);
  const [error, setError] = useState<string>();
  const [saveStatus, setSaveStatus] = useState<DashboardSaveStatus>('saved');
  const [agentMode, setAgentMode] = useState(initialAgentModeState);
  const [queryInputsRevision, setQueryInputsRevision] = useState(0);
  const loadDashboard = useCallback(
    async (includeSharing = true) => {
      try {
        const loaded = await callApi<DashboardPayload>({
          action: 'getDashboard',
          dashboardId,
          includeSharing,
        });
        if (controlDashboardIdRef.current !== loaded.dashboard.id) {
          controlDashboardIdRef.current = loaded.dashboard.id;
          setBuilderControlState(initialControlState(loaded.dashboard));
        }
        dashboardQuery.setData((current) => ({
          ...loaded,
          sharing:
            loaded.sharing ??
            (current?.dashboard.id === loaded.dashboard.id ? current.sharing : undefined),
        }));
        setError(undefined);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    [dashboardId, callApi, dashboardQuery.setData],
  );
  const refresh = useCallback(() => loadDashboard(false), [loadDashboard]);
  const refreshSharing = useCallback(() => loadDashboard(true), [loadDashboard]);
  useEffect(() => {
    if (payload && controlDashboardIdRef.current !== payload.dashboard.id) {
      controlDashboardIdRef.current = payload.dashboard.id;
      setBuilderControlState(initialControlState(payload.dashboard));
    }
  }, [payload]);
  // Agent tools can change inputs that widget definitions do not carry (timezone, default date
  // range, fields, metrics), so their mutations re-run the widget queries.
  const refreshAfterTool = useCallback(async () => {
    await refreshSharing();
    setQueryInputsRevision((value) => value + 1);
  }, [refreshSharing]);
  const canEdit = payload?.role === 'admin' || payload?.role === 'editor';
  const previewingAsViewer = canEdit && search.preview === 'viewer';
  // Viewer preview removes editor permissions and WebMCP write tools. Agent mode only swaps out
  // the editing controls, so the agent can keep changing the dashboard while the user watches.
  const editing = canEdit && !previewingAsViewer;
  const activateAgentMode = useCallback(() => setAgentMode(activateAgentModeFromToolUse), []);
  usePageTitle(payload?.dashboard.name ?? 'Dashboard');
  const { available: webMcpAvailable } = useWebMcpTools({
    dashboardId,
    canCreate: Boolean(payload),
    canEdit: editing,
    isAdmin: payload?.role === 'admin' && editing,
    onToolUse: activateAgentMode,
    onMutation: refreshAfterTool,
  });
  const displayedDashboard =
    payload &&
    (previewingAsViewer
      ? { ...payload.dashboard, pages: payload.dashboard.pages.filter((page) => !page.hidden) }
      : payload.dashboard);
  const activePage = displayedDashboard && activeDashboardPage(displayedDashboard, search.page);
  return (
    <DashboardQueryRefresh key={dashboardId} inputsRevision={queryInputsRevision}>
      <main className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6">
        {error || dashboardQuery.error ? (
          <ErrorState
            error={error ?? dashboardQuery.error?.message ?? 'Failed to load dashboard.'}
          />
        ) : !payload ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <h1 className="text-3xl font-semibold tracking-tight">{payload.dashboard.name}</h1>
              {/* The editor controls stay put in both modes so the switch never moves under the
                cursor, even though a real viewer sees neither of them. */}
              <div className="flex max-w-full items-start gap-3 sm:items-center">
                <DashboardRefreshButton />
                {canEdit ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    {editing && webMcpAvailable ? (
                      <Label className="text-muted-foreground" htmlFor="agent-mode">
                        Agent mode
                        <Switch
                          id="agent-mode"
                          checked={agentMode.enabled}
                          onCheckedChange={(checked) => setAgentMode(selectAgentMode(checked))}
                        />
                      </Label>
                    ) : null}
                    <Label className="text-muted-foreground" htmlFor="viewer-mode">
                      Viewer mode
                      <Switch
                        id="viewer-mode"
                        checked={previewingAsViewer}
                        onCheckedChange={(checked) =>
                          void navigate({
                            search: (current) => ({
                              ...current,
                              preview: checked ? ('viewer' as const) : undefined,
                            }),
                          })
                        }
                      />
                    </Label>
                    <SaveStatusIndicator status={saveStatus} />
                    <DuplicateDashboard
                      dashboard={{
                        id: dashboardId,
                        name: payload.dashboard.name,
                        dataSourceIds: [
                          ...new Set(
                            dashboardWidgets(payload.dashboard).flatMap((widget) =>
                              'dataSourceId' in widget.definition
                                ? [widget.definition.dataSourceId]
                                : [],
                            ),
                          ),
                        ],
                      }}
                      dataSources={payload.dataSources}
                      disabled={saveStatus !== 'saved'}
                    />
                    <DashboardSharing
                      dashboardId={dashboardId}
                      sharing={payload.sharing ?? { links: [], grants: [] }}
                      refresh={refreshSharing}
                    />
                  </div>
                ) : null}
              </div>
            </header>
            <DashboardPages
              dashboard={displayedDashboard!}
              pageId={activePage?.id}
              canEdit={editing}
              disabled={saveStatus === 'saving'}
              refresh={refresh}
              onPageChange={(page) =>
                void navigate({ search: (current) => ({ ...current, page }) })
              }
            />
            {activePage ? (
              editing && !agentMode.enabled ? (
                <DashboardBuilder
                  key={activePage.id}
                  controlState={builderControlState}
                  setControlState={setBuilderControlState}
                  dashboard={payload.dashboard}
                  pageId={activePage.id}
                  dataSources={payload.dataSources}
                  refresh={refresh}
                  onSaveStatusChange={setSaveStatus}
                />
              ) : (
                <DashboardView
                  dashboard={displayedDashboard!}
                  pageId={activePage.id}
                  dateRange={parseDateRangeSearch(search.dateRange)}
                  onDateRangeChange={(range) => {
                    const defaultRange = dashboardDateControlRange(payload.dashboard);
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
              )
            ) : null}
          </div>
        )}
      </main>
    </DashboardQueryRefresh>
  );
}

function SaveStatusIndicator({ status }: { status: DashboardSaveStatus }) {
  const label =
    status === 'saving'
      ? 'Saving changes'
      : status === 'error'
        ? 'Changes could not be saved'
        : 'Changes saved';

  return (
    <span
      className="grid size-8 place-items-center text-muted-foreground"
      role="status"
      aria-label={label}
      title={label}
    >
      {status === 'saving' ? (
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : status === 'error' ? (
        <CloudAlertIcon className="size-4 text-destructive" aria-hidden />
      ) : (
        <CloudCheckIcon className="size-4" aria-hidden />
      )}
    </span>
  );
}
