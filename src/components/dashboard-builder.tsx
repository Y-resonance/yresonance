import { dashboardDateControlRange } from '#/components/dashboard-view';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from './ui/select';
import { Field, FieldLabel } from './ui/field';
import { dashboardCanvas, type DashboardCanvas } from '#/domain/dashboard-pages';
import { dashboardControlWidgets, dashboardWidgets } from '#/domain/schema';
import {
  type DashboardDocument,
  type ControlState,
  type DashboardWidget,
  type DateRange,
  type WidgetDefinition,
} from '#/domain/schema';
import { useState, useRef, useEffect, type Dispatch, type SetStateAction } from 'react';
import { createSerialQueue } from '#/domain/serial-queue';
import { type Layout, type LayoutItem } from 'react-grid-layout';
import { sameDateRange } from '#/domain/date-range-search';
import { callApi } from '#/api/client';
import {
  rollbackFailedLayoutState,
  insertRow,
  removeEmptyRow,
  isRowEmpty,
  appendPlacement,
} from '#/domain/layout';
import { type LibraryMetricDraft } from '#/components/metric-formula-dialog';
import { clearControlValue } from '#/domain/widget-editing';
import { withoutWidgetControlState, reconcileDashboardControls } from '#/domain/control-state';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '#/components/ui/sheet';
import { Button } from '#/components/ui/button';
import { Settings2Icon, Grid2X2PlusIcon } from 'lucide-react';
import { Alert, AlertDescription } from '#/components/ui/alert';
import { Popover, PopoverTrigger, PopoverContent } from '#/components/ui/popover';
import { widgetLabel } from '#/domain/widget-label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '#/components/ui/dialog';
import { type BuilderDataSource, type BuilderType, message } from './dashboard-builder/shared';
import { catalog, WidgetCatalog } from './dashboard-builder/catalog';
import { defaultDefinition } from './dashboard-builder/datasource';
import { layoutFor, BuilderCanvas } from './dashboard-builder/canvas-layout';
import { WidgetSettings } from './dashboard-builder/widget-inspector';

export type DashboardSaveStatus = 'saved' | 'saving' | 'error';

export function DashboardBuilder({
  dashboard: initialDashboard,
  pageId,
  controlState,
  setControlState,
  dataSources,
  refresh,
  onSaveStatusChange,
}: {
  dashboard: DashboardDocument;
  pageId: string;
  controlState: ControlState;
  setControlState: Dispatch<SetStateAction<ControlState>>;
  dataSources: BuilderDataSource[];
  refresh: () => Promise<void>;
  onSaveStatusChange: (status: DashboardSaveStatus) => void;
}) {
  const [dashboard, setDashboard] = useState(() => dashboardCanvas(initialDashboard, pageId));
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [pendingOperations, setPendingOperations] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingWidgets, setPendingWidgets] = useState<Record<string, number>>({});
  const [removeTarget, setRemoveTarget] = useState<DashboardWidget>();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [desktop, setDesktop] = useState<boolean>();
  const dashboardRef = useRef(dashboard);
  const mutationQueueRef = useRef(createSerialQueue());
  const mutationRevisionRef = useRef(0);
  const appliedDefaultDateRangeRef = useRef<DateRange | undefined>(
    dashboardDateControlRange(initialDashboard),
  );
  const draggedType = useRef<BuilderType | undefined>(undefined);
  const saving = pendingOperations > 0;
  useEffect(() => {
    setControlState((current) => reconcileDashboardControls(dashboard, current));
  }, [dashboard.pages]);

  useEffect(() => {
    const canvas = dashboardCanvas(initialDashboard, pageId);
    dashboardRef.current = canvas;
    setDashboard(canvas);
  }, [initialDashboard, pageId]);
  useEffect(() => {
    setSelectedId(undefined);
    setMobileOpen(false);
  }, [pageId]);
  useEffect(() => {
    onSaveStatusChange(saving ? 'saving' : error ? 'error' : 'saved');
  }, [error, onSaveStatusChange, saving]);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 48rem)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    // Base UI dialogs, popovers and selects handle Escape on `document` and mark the event
    // as defaulted, so the window listener below only sees presses nothing else claimed.
    const deselect = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setSelectedId(undefined);
    };
    window.addEventListener('keydown', deselect);
    return () => window.removeEventListener('keydown', deselect);
  }, []);
  useEffect(() => {
    const dateControl = dashboardControlWidgets(dashboard).find(
      (widget) => widget.definition.type === 'dateControl',
    );
    if (!dateControl || dateControl.definition.type !== 'dateControl') {
      appliedDefaultDateRangeRef.current = undefined;
      return;
    }
    const defaultDateRange = dateControl.definition.defaultDateRange ?? dashboard.defaultDateRange;
    const previousDefault = appliedDefaultDateRangeRef.current;
    if (previousDefault && sameDateRange(previousDefault, defaultDateRange)) return;
    appliedDefaultDateRangeRef.current = defaultDateRange;
    setControlState((current) => ({ ...current, dateRange: defaultDateRange }));
  }, [dashboard.defaultDateRange, dashboard.pages]);

  function updateDashboard(updater: (current: DashboardCanvas) => DashboardCanvas) {
    const edited = updater(dashboardRef.current);
    const next = {
      ...edited,
      pages: edited.pages.map((page) =>
        page.id === pageId
          ? { ...page, widgets: edited.widgets, canvasRows: edited.canvasRows }
          : page,
      ),
    };
    dashboardRef.current = next;
    setDashboard(next);
    return next;
  }

  function enqueueMutation<T>(operation: () => Promise<T>) {
    return mutationQueueRef.current(operation);
  }

  function startSaving() {
    setPendingOperations((current) => current + 1);
  }

  function finishSaving() {
    setPendingOperations((current) => Math.max(0, current - 1));
  }

  const selected = dashboard.widgets.find((widget) => widget.id === selectedId);

  async function saveLayout(next: Layout, requestedCanvasRows = dashboardRef.current.canvasRows) {
    const revision = ++mutationRevisionRef.current;
    const byId = new Map(next.map((item) => [item.i, item]));
    const canvasRows = Math.max(10, requestedCanvasRows, ...next.map((item) => item.y + item.h));
    const previousLayouts = new Map(
      dashboardRef.current.widgets.map((widget) => [widget.id, widget.layout]),
    );
    const previousCanvasRows = dashboardRef.current.canvasRows;
    const optimistic = updateDashboard((current) => ({
      ...current,
      canvasRows,
      widgets: current.widgets.map((widget) => {
        const item = byId.get(widget.id);
        return item
          ? {
              ...widget,
              layout: { x: item.x, y: item.y, width: item.w, height: item.h },
            }
          : widget;
      }),
    }));
    const optimisticLayouts = new Map(
      optimistic.widgets.map((widget) => [widget.id, widget.layout]),
    );
    startSaving();
    setError(undefined);
    try {
      await enqueueMutation(() => {
        const current = dashboardRef.current;
        return callApi({
          action: 'updateLayout',
          pageId,
          dashboardId: current.id,
          canvasRows: current.canvasRows,
          placements: current.widgets.map((widget) => ({
            widgetId: widget.id,
            placement: widget.layout,
          })),
        });
      });
      if (revision === mutationRevisionRef.current) {
        setError(undefined);
        await refresh();
      }
    } catch (caught) {
      if (revision === mutationRevisionRef.current)
        updateDashboard((current) => ({
          ...current,
          ...rollbackFailedLayoutState(
            current,
            { placements: previousLayouts, canvasRows: previousCanvasRows },
            { placements: optimisticLayouts, canvasRows },
          ),
        }));
      if (revision === mutationRevisionRef.current) setError(message(caught));
    } finally {
      finishSaving();
    }
  }

  async function addWidget(type: BuilderType, dropped?: LayoutItem) {
    const entry = catalog.find((item) => item.type === type)!;
    let revision: number | undefined;
    startSaving();
    setError(undefined);
    try {
      const definition = await defaultDefinition(type, dataSources[0]);
      revision = ++mutationRevisionRef.current;
      const result = await enqueueMutation(() =>
        callApi<{ widget: DashboardWidget }>({
          action: 'addWidget',
          pageId,
          dashboardId: dashboardRef.current.id,
          definition,
          width: dropped?.w ?? entry.size.width,
          height: dropped?.h ?? entry.size.height,
        }),
      );
      const widget = result.widget;
      const next = updateDashboard((current) => ({
        ...current,
        canvasRows: Math.max(current.canvasRows, widget.layout.y + widget.layout.height + 2),
        widgets: current.widgets.some((item) => item.id === widget.id)
          ? current.widgets
          : [...current.widgets, widget],
      }));
      setSelectedId(widget.id);
      setMobileOpen(true);
      if (dropped)
        await saveLayout(
          next.widgets.map((item) => ({
            i: item.id,
            x: item.id === widget.id ? dropped.x : item.layout.x,
            y: item.id === widget.id ? dropped.y : item.layout.y,
            w: item.id === widget.id ? dropped.w : item.layout.width,
            h: item.id === widget.id ? dropped.h : item.layout.height,
          })),
        );
      else if (revision === mutationRevisionRef.current) {
        setError(undefined);
        await refresh();
      }
    } catch (caught) {
      if (revision === undefined || revision === mutationRevisionRef.current)
        setError(message(caught));
    } finally {
      finishSaving();
    }
  }

  async function updateWidget(
    widget: DashboardWidget,
    definition: WidgetDefinition,
    libraryMetric?: LibraryMetricDraft,
  ) {
    const revision = ++mutationRevisionRef.current;
    const previous = widget;
    const controlFieldChanged =
      widget.definition.type === 'control' &&
      definition.type === 'control' &&
      (widget.definition.dataSourceId !== definition.dataSourceId ||
        widget.definition.fieldId !== definition.fieldId);
    const previousControlValues = controlState.values?.[widget.id];
    if (controlFieldChanged) setControlState((current) => clearControlValue(current, widget.id));
    updateDashboard((current) => ({
      ...current,
      widgets: current.widgets.map((item) =>
        item.id === widget.id ? { ...item, definition } : item,
      ),
    }));
    setPendingWidgets((current) => ({
      ...current,
      [widget.id]: (current[widget.id] ?? 0) + 1,
    }));
    startSaving();
    setError(undefined);
    try {
      const result = await enqueueMutation(() =>
        callApi<{ widget: DashboardWidget }>({
          action: 'updateWidget',
          dashboardId: dashboardRef.current.id,
          widgetId: widget.id,
          definition,
          libraryMetric,
        }),
      );
      updateDashboard((current) => ({
        ...current,
        widgets: current.widgets.map((item) =>
          item.id === widget.id && item.definition === definition
            ? {
                ...item,
                definition: result.widget.definition,
                definitionHash: result.widget.definitionHash,
              }
            : item,
        ),
      }));
      if (revision === mutationRevisionRef.current) {
        setError(undefined);
        try {
          await refresh();
        } catch (caught) {
          if (revision === mutationRevisionRef.current) setError(message(caught));
        }
      }
      return true;
    } catch (caught) {
      if (
        controlFieldChanged &&
        dashboardRef.current.widgets.find((item) => item.id === widget.id)?.definition ===
          definition
      )
        setControlState((current) => {
          if ((current.values?.[widget.id]?.length ?? 0) > 0) return current;
          const values = { ...current.values };
          if (previousControlValues) values[widget.id] = previousControlValues;
          else delete values[widget.id];
          return { ...current, values: Object.keys(values).length ? values : undefined };
        });
      updateDashboard((current) => ({
        ...current,
        widgets: current.widgets.map((item) =>
          item.id === widget.id && item.definition === definition
            ? {
                ...item,
                definition: previous.definition,
                definitionHash: previous.definitionHash,
              }
            : item,
        ),
      }));
      if (revision === mutationRevisionRef.current) setError(message(caught));
      return false;
    } finally {
      setPendingWidgets((current) => {
        const next = (current[widget.id] ?? 1) - 1;
        if (next > 0) return { ...current, [widget.id]: next };
        const { [widget.id]: _removed, ...rest } = current;
        return rest;
      });
      finishSaving();
    }
  }

  async function removeWidget(widget: DashboardWidget) {
    const revision = ++mutationRevisionRef.current;
    startSaving();
    setError(undefined);
    try {
      await enqueueMutation(() =>
        callApi({
          action: 'removeWidget',
          dashboardId: dashboardRef.current.id,
          widgetId: widget.id,
        }),
      );
      updateDashboard((current) => {
        const next = {
          ...current,
          widgets: current.widgets.filter((item) => item.id !== widget.id),
        };
        setControlState((controlState) =>
          withoutWidgetControlState(
            controlState,
            widget,
            dashboardWidgets(next).some((item) => item.definition.type === 'dateControl'),
          ),
        );
        return next;
      });
      setSelectedId((current) => (current === widget.id ? undefined : current));
      if (revision === mutationRevisionRef.current) {
        setError(undefined);
        await refresh();
      }
      return true;
    } catch (caught) {
      if (revision === mutationRevisionRef.current) setError(message(caught));
      return false;
    } finally {
      finishSaving();
    }
  }

  async function moveToPage(widget: DashboardWidget, targetPageId: string) {
    const target = dashboardRef.current.pages.find((page) => page.id === targetPageId);
    if (!target) return;
    startSaving();
    setError(undefined);
    try {
      await enqueueMutation(() =>
        callApi({
          action: 'moveWidget',
          dashboardId: dashboardRef.current.id,
          widgetId: widget.id,
          pageId: target.id,
          placement: appendPlacement(
            target.widgets,
            widget.layout.width,
            widget.layout.height,
            dashboardRef.current.columns,
          ),
        }),
      );
      setSelectedId(undefined);
      await refresh();
    } catch (caught) {
      setError(message(caught));
    } finally {
      finishSaving();
    }
  }

  function saveRowInsertion(cut: number) {
    const next = insertRow(dashboardRef.current.widgets, dashboardRef.current.canvasRows, cut);
    if (!next) return;
    void saveLayout(layoutFor(next.widgets), next.canvasRows);
  }

  function saveRowRemoval(row: number) {
    const next = removeEmptyRow(dashboardRef.current.widgets, dashboardRef.current.canvasRows, row);
    if (!next) return;
    void saveLayout(layoutFor(next.widgets), next.canvasRows);
  }

  const inspectorPanel = (
    <fieldset disabled={saving} className="min-w-0 border-0 p-0">
      {selected ? (
        <>
          <WidgetSettings
            dashboardId={dashboard.id}
            dashboardDefaultDateRange={dashboard.defaultDateRange}
            timezone={dashboard.timezone}
            widget={selected}
            dataSources={dataSources}
            onClose={() => setSelectedId(undefined)}
            onChange={(definition, libraryMetric) =>
              updateWidget(selected, definition, libraryMetric)
            }
            onRemoveEmptyRowAbove={
              dashboard.canvasRows > 10 &&
              selected.layout.y > 0 &&
              isRowEmpty(dashboard.widgets, selected.layout.y - 1)
                ? () => saveRowRemoval(selected.layout.y - 1)
                : undefined
            }
            onRemoveEmptyRowBelow={
              dashboard.canvasRows > 10 &&
              selected.layout.y + selected.layout.height < dashboard.canvasRows &&
              isRowEmpty(dashboard.widgets, selected.layout.y + selected.layout.height)
                ? () => saveRowRemoval(selected.layout.y + selected.layout.height)
                : undefined
            }
          />
          {dashboard.pages.length > 1 ? (
            <Field className="mt-4">
              <FieldLabel htmlFor="move-widget-page">Move to page</FieldLabel>
              <Select
                value={null}
                onValueChange={(value) => {
                  if (value) void moveToPage(selected, value);
                }}
              >
                <SelectTrigger id="move-widget-page">
                  <SelectValue placeholder="Choose page" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {dashboard.pages
                      .filter((page) => page.id !== pageId)
                      .map((page) => (
                        <SelectItem key={page.id} value={page.id}>
                          {page.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Select a widget to edit it.</p>
      )}
    </fieldset>
  );
  const catalogPanel = (
    <WidgetCatalog
      disabled={saving}
      hasDateControl={dashboardWidgets(dashboard).some(
        (widget) => widget.definition.type === 'dateControl',
      )}
      onAdd={async (type) => {
        setCatalogOpen(false);
        await addWidget(type);
      }}
      onDragStart={(type) => {
        draggedType.current = type;
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {desktop === false ? (
        <div className="flex items-center justify-end">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm" />}>
              {selected ? (
                <Settings2Icon data-icon="inline-start" />
              ) : (
                <Grid2X2PlusIcon data-icon="inline-start" />
              )}
              {selected ? 'Widget settings' : 'Add widget'}
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(92vw,24rem)] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{selected ? 'Widget settings' : 'Add widget'}</SheetTitle>
                <SheetDescription>
                  Every builder action is available without drag and resize.
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">{selected ? inspectorPanel : catalogPanel}</div>
            </SheetContent>
          </Sheet>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {desktop !== false ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Popover open={catalogOpen} onOpenChange={setCatalogOpen}>
                  <PopoverTrigger render={<Button variant="outline" size="sm" />}>
                    <Grid2X2PlusIcon data-icon="inline-start" />
                    Add widget
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[21rem]">
                    {catalogPanel}
                  </PopoverContent>
                </Popover>
              </div>
            </>
          ) : null}
          <BuilderCanvas
            dashboard={dashboard}
            desktop={desktop}
            saving={saving}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            setMobileOpen={setMobileOpen}
            setRemoveTarget={setRemoveTarget}
            pendingWidgets={pendingWidgets}
            controlState={controlState}
            setControlState={setControlState}
            draggedType={draggedType}
            setCatalogOpen={setCatalogOpen}
            addWidget={addWidget}
            saveLayout={saveLayout}
            saveRowInsertion={saveRowInsertion}
            saveRowRemoval={saveRowRemoval}
          />
        </div>
        {desktop ? (
          <aside className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">
            {inspectorPanel}
          </aside>
        ) : null}
      </div>
      <Dialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTarget(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget ? widgetLabel(removeTarget) : 'widget'}?</DialogTitle>
            <DialogDescription>
              The widget and its settings are deleted from this dashboard. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={removing}>
              Keep widget
            </DialogClose>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={async () => {
                if (!removeTarget) return;
                setRemoving(true);
                try {
                  if (await removeWidget(removeTarget)) setRemoveTarget(undefined);
                } finally {
                  setRemoving(false);
                }
              }}
            >
              {removing ? 'Removing...' : 'Remove widget'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { BuilderDataSource } from './dashboard-builder/shared';
