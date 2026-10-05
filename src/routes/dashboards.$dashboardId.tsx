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
import { callApi } from '#/api/client';
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
import { Badge } from '#/components/ui/badge';
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
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
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
  const { dashboardId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [payload, setPayload] = useState<DashboardPayload>();
  const [builderControlState, setBuilderControlState] = useState<ControlState>({});
  const controlDashboardIdRef = useRef<string>(undefined);
  const [error, setError] = useState<string>();
  const [saveStatus, setSaveStatus] = useState<DashboardSaveStatus>('saved');
  const [agentMode, setAgentMode] = useState(initialAgentModeState);
  const refresh = useCallback(async () => {
    try {
      const loaded = await callApi<DashboardPayload>({ action: 'getDashboard', dashboardId });
      if (controlDashboardIdRef.current !== loaded.dashboard.id) {
        controlDashboardIdRef.current = loaded.dashboard.id;
        setBuilderControlState(initialControlState(loaded.dashboard));
      }
      setPayload(loaded);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  }, [dashboardId]);
  useEffect(() => void refresh().catch(() => undefined), [refresh]);
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
    onMutation: refresh,
  });
  const displayedDashboard =
    payload &&
    (previewingAsViewer
      ? { ...payload.dashboard, pages: payload.dashboard.pages.filter((page) => !page.hidden) }
      : payload.dashboard);
  const activePage = displayedDashboard && activeDashboardPage(displayedDashboard, search.page);
  return (
    <DashboardQueryRefresh key={dashboardId}>
      <main className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6">
        {error ? (
          <ErrorState error={error} />
        ) : !payload ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-3xl font-semibold tracking-tight">
                    {payload.dashboard.name}
                  </h1>
                  <Badge variant="secondary">{previewingAsViewer ? 'viewer' : payload.role}</Badge>
                </div>
              </div>
              {/* The editor controls stay put in both modes so the switch never moves under the
                cursor, even though a real viewer sees neither of them. */}
              <div className="flex items-center gap-3">
                <DashboardRefreshButton />
                {canEdit ? (
                  <div className="flex items-center gap-3">
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
                      refresh={refresh}
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
