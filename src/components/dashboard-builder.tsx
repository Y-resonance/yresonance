import {
  ActivityIcon,
  AlignCenterVerticalIcon,
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  CaseUpperIcon,
  ChartNoAxesColumnIcon,
  ChartScatterIcon,
  CircleHelpIcon,
  CircleGaugeIcon,
  CircleDivideIcon,
  FingerprintIcon,
  Grid2X2PlusIcon,
  GripVerticalIcon,
  HashIcon,
  LineChartIcon,
  ListFilterIcon,
  MinusIcon,
  PencilIcon,
  PieChartIcon,
  PlusIcon,
  Settings2Icon,
  SigmaIcon,
  SquareFunctionIcon,
  Table2Icon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, {
  noCompactor,
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from 'react-grid-layout';
import { GridBackground } from 'react-grid-layout/extras';
import { callApi } from '#/api/client';
import { DateRangePicker } from '#/components/date-range-picker';
import { CalculatedFieldDialog } from '#/components/calculated-field-dialog';
import { DashboardWidgetView, initialControlState } from '#/components/dashboard-view';
import { MetricFormulaDialog, type LibraryMetricDraft } from '#/components/metric-formula-dialog';
import { Alert, AlertDescription } from '#/components/ui/alert';
import { Button } from '#/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#/components/ui/command';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet';
import { Textarea } from '#/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { Switch } from '#/components/ui/switch';
import { cn } from '#/lib/utils';
import {
  clearControlValue,
  filterInputValue,
  filterValueFromInput,
  patchFilterCondition,
} from '#/domain/widget-editing';
import { remapWidgetDefinition } from '#/domain/remap';
import { replacePlainTextDocument, textDocument } from '#/domain/text-content';
import { textStyleClasses } from '#/domain/text-style';
import { withoutWidgetControlState } from '#/domain/control-state';
import { sameDateRange } from '#/domain/date-range-search';
import { yearToDateRange } from '#/domain/dates';
import { createSerialQueue } from '#/domain/serial-queue';
import {
  insertRow,
  isRowEmpty,
  removeEmptyRow,
  rollbackFailedLayoutState,
  rowInsertionCuts,
} from '#/domain/layout';
import { widgetLabel } from '#/domain/widget-label';
import type { DatasourceDescription, DatasourceFieldRow } from '#/domain/datasource-fields';
import { fieldRoleSchema, textStyleSchema } from '#/domain/schema';
import type {
  ControlState,
  Aggregation,
  BarColorBy,
  DashboardDocument,
  DashboardWidget,
  DateGranularity,
  DateRange,
  FieldRole,
  SemanticType,
  TextStyle,
  WidgetDefinition,
  WidgetMetric,
} from '#/domain/schema';

export interface BuilderDataSource {
  id: string;
  name: string;
}

export type DashboardSaveStatus = 'saved' | 'saving' | 'error';

type SourceField =
  | DatasourceDescription['fields'][number]
  | DatasourceDescription['calculatedFields'][number];
type SourceDescription = DatasourceDescription;

type BuilderType = WidgetDefinition['type'];

const catalog: Array<{
  type: BuilderType;
  label: string;
  icon: typeof BarChart3Icon;
  size: { width: number; height: number };
}> = [
  {
    type: 'scorecard',
    label: 'Scorecard',
    icon: ChartNoAxesColumnIcon,
    size: { width: 4, height: 3 },
  },
  { type: 'gauge', label: 'Gauge', icon: CircleGaugeIcon, size: { width: 4, height: 3 } },
  { type: 'line', label: 'Line chart', icon: LineChartIcon, size: { width: 8, height: 5 } },
  { type: 'bar', label: 'Bar chart', icon: BarChart3Icon, size: { width: 8, height: 5 } },
  { type: 'pie', label: 'Pie chart', icon: PieChartIcon, size: { width: 6, height: 5 } },
  { type: 'table', label: 'Table', icon: Table2Icon, size: { width: 8, height: 5 } },
  // Controls hold a label and one input, so a single row fits them without leaving dead space.
  { type: 'control', label: 'Filter control', icon: ListFilterIcon, size: { width: 4, height: 1 } },
  {
    type: 'dateControl',
    label: 'Date control',
    icon: CalendarDaysIcon,
    size: { width: 4, height: 1 },
  },
  { type: 'text', label: 'Text', icon: CaseUpperIcon, size: { width: 6, height: 2 } },
];

export function DashboardBuilder({
  dashboard: initialDashboard,
  dataSources,
  refresh,
  onSaveStatusChange,
}: {
  dashboard: DashboardDocument;
  dataSources: BuilderDataSource[];
  refresh: () => Promise<void>;
  onSaveStatusChange: (status: DashboardSaveStatus) => void;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [selectedId, setSelectedId] = useState<string>();
  const [controlState, setControlState] = useState<ControlState>(() =>
    initialControlState(initialDashboard),
  );
  const [error, setError] = useState<string>();
  const [pendingOperations, setPendingOperations] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chartRevision, setChartRevision] = useState(0);
  const [pendingWidgets, setPendingWidgets] = useState<Record<string, number>>({});
  const [removeTarget, setRemoveTarget] = useState<DashboardWidget>();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [desktop, setDesktop] = useState<boolean>();
  const dashboardRef = useRef(dashboard);
  const mutationQueueRef = useRef(createSerialQueue());
  const mutationRevisionRef = useRef(0);
  const appliedDefaultDateRangeRef = useRef<DateRange | undefined>(undefined);
  const draggedType = useRef<BuilderType | undefined>(undefined);
  // Set while the grid is moving or resizing a widget: the click that ends such a gesture
  // lands on the canvas background and must not be read as a deselect.
  const gridGestureRef = useRef(false);
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const saving = pendingOperations > 0;

  useEffect(() => {
    dashboardRef.current = initialDashboard;
    setDashboard(initialDashboard);
  }, [initialDashboard]);
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
    const dateControl = dashboard.widgets.find(
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
  }, [dashboard.defaultDateRange, dashboard.widgets]);

  function updateDashboard(updater: (current: DashboardDocument) => DashboardDocument) {
    const next = updater(dashboardRef.current);
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

  const layout = useMemo<Layout>(
    () =>
      dashboard.widgets.map((widget) => {
        const control =
          widget.definition.type === 'control' || widget.definition.type === 'dateControl';
        return {
          i: widget.id,
          x: widget.layout.x,
          y: widget.layout.y,
          w: widget.layout.width,
          h: widget.layout.height,
          minW: control ? 4 : 2,
          minH: control ? 1 : 2,
        };
      }),
    [dashboard.widgets],
  );
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
            next.widgets.some((item) => item.definition.type === 'dateControl'),
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
      ) : (
        <p className="text-sm text-muted-foreground">Select a widget to edit it.</p>
      )}
    </fieldset>
  );
  const catalogPanel = (
    <WidgetCatalog
      disabled={saving}
      hasDateControl={dashboard.widgets.some((widget) => widget.definition.type === 'dateControl')}
      onAdd={async (type) => {
        setCatalogOpen(false);
        await addWidget(type);
      }}
      onDragStart={(type) => {
        draggedType.current = type;
      }}
    />
  );

  const gridRows = dashboard.canvasRows;
  // Matches the height GridBackground draws (56px cells + 8px margins).
  const canvasHeight = gridRows * 64 + 8;
  const insertionCuts = rowInsertionCuts(dashboard.widgets, dashboard.canvasRows);

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
              <div
                ref={containerRef}
                className="relative"
                style={{ minHeight: canvasHeight }}
                onPointerDownCapture={() => {
                  gridGestureRef.current = false;
                }}
                onClick={() => {
                  if (gridGestureRef.current) {
                    gridGestureRef.current = false;
                    return;
                  }
                  setSelectedId(undefined);
                }}
              >
                {mounted ? (
                  <>
                    <GridBackground
                      width={width}
                      cols={12}
                      rowHeight={56}
                      margin={[8, 8]}
                      rows={gridRows}
                      color="color-mix(in srgb, var(--color-muted) 96%, var(--color-foreground) 4%)"
                      // Numeric prop, so --radius-xl (0.625rem * 1.4) is inlined here to keep the
                      // empty cells on the same radius as the widget cards that land on them.
                      borderRadius={14}
                    />
                    {insertionCuts.map((cut) => (
                      <RowInsertionControl
                        key={cut}
                        cut={cut}
                        disabled={saving}
                        onInsert={() => saveRowInsertion(cut)}
                      />
                    ))}
                    {gridRows > 10
                      ? Array.from({ length: gridRows }, (_, row) => row)
                          .filter((row) => isRowEmpty(dashboard.widgets, row))
                          .map((row) => (
                            <RowRemovalControl
                              key={row}
                              row={row}
                              disabled={saving}
                              onRemove={() => saveRowRemoval(row)}
                            />
                          ))
                      : null}
                    <GridLayout
                      // The grid only accepts drops on its own element, which otherwise ends at the
                      // lowest widget, so it has to span the spare rows (all of an empty canvas).
                      style={{ minHeight: canvasHeight }}
                      width={width}
                      layout={layout}
                      compactor={noCompactor}
                      gridConfig={{ cols: 12, rowHeight: 56, margin: [8, 8] }}
                      dragConfig={{ enabled: !saving, handle: '.widget-drag-handle', threshold: 8 }}
                      resizeConfig={{
                        enabled: !saving,
                        handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
                      }}
                      dropConfig={{ enabled: !saving, defaultItem: { w: 4, h: 3 } }}
                      droppingItem={{ i: '__dropping__', x: 0, y: 0, w: 4, h: 3 }}
                      onDrop={(next, item) => {
                        const type = draggedType.current;
                        draggedType.current = undefined;
                        setCatalogOpen(false);
                        if (type && item) void addWidget(type, item);
                        else if (next.length === dashboard.widgets.length) void saveLayout(next);
                      }}
                      onDropDragOver={() => {
                        const entry = catalog.find((item) => item.type === draggedType.current);
                        return entry ? { w: entry.size.width, h: entry.size.height } : false;
                      }}
                      onDragStart={() => {
                        gridGestureRef.current = true;
                      }}
                      onResizeStart={() => {
                        gridGestureRef.current = true;
                      }}
                      onDragStop={(next) => void saveLayout(next)}
                      onResizeStop={(next) => {
                        setChartRevision((value) => value + 1);
                        void saveLayout(next);
                      }}
                    >
                      {dashboard.widgets.map((widget) => (
                        <div
                          key={widget.id}
                          data-widget-id={widget.id}
                          className={cn(
                            'group overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-ring',
                            selectedId === widget.id && 'ring-2 ring-primary',
                          )}
                          onClick={(event) => {
                            // Keeps the canvas background click from deselecting again.
                            event.stopPropagation();
                            setSelectedId(widget.id);
                          }}
                        >
                          {/* Pointer users drag it; Enter selects the widget for the settings form. */}
                          <Button
                            className="widget-drag-handle absolute top-2 left-1/2 z-10 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${widgetLabel(widget)}`}
                            onClick={() => setSelectedId(widget.id)}
                          >
                            <GripVerticalIcon />
                          </Button>
                          <Button
                            className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${widgetLabel(widget)}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setRemoveTarget(widget);
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                          <div
                            key={`${widget.id}-${chartRevision}`}
                            className="h-full [&>[data-slot=card]]:h-full"
                          >
                            <DashboardWidgetView
                              dashboard={dashboard}
                              widget={widget}
                              preview={Boolean(pendingWidgets[widget.id])}
                              controlState={controlState}
                              setControlState={setControlState}
                            />
                          </div>
                        </div>
                      ))}
                    </GridLayout>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
          {desktop === false ? (
            <div className="flex flex-col gap-4">
              {[...dashboard.widgets]
                .sort(
                  (left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x,
                )
                .map((widget) => (
                  <div
                    key={widget.id}
                    data-widget-id={widget.id}
                    className="relative rounded-xl ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-ring"
                  >
                    <div className="absolute top-2 right-2 z-10 flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Edit ${widgetLabel(widget)}`}
                        onClick={() => {
                          setSelectedId(widget.id);
                          setMobileOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Remove ${widgetLabel(widget)}`}
                        onClick={() => setRemoveTarget(widget)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    <DashboardWidgetView
                      dashboard={dashboard}
                      widget={widget}
                      preview={Boolean(pendingWidgets[widget.id])}
                      controlState={controlState}
                      setControlState={setControlState}
                    />
                  </div>
                ))}
            </div>
          ) : null}
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

function layoutFor(widgets: DashboardWidget[]): Layout {
  return widgets.map((widget) => ({
    i: widget.id,
    x: widget.layout.x,
    y: widget.layout.y,
    w: widget.layout.width,
    h: widget.layout.height,
  }));
}

function RowInsertionControl({
  cut,
  disabled,
  onInsert,
}: {
  cut: number;
  disabled: boolean;
  onInsert: () => void;
}) {
  const label = cut === 0 ? 'Insert first row' : `Insert row after row ${cut}`;
  return (
    <div
      className="group/row absolute right-2 left-2 z-20 flex h-6 -translate-y-1/2 items-center"
      style={{ top: cut === 0 ? 8 : cut * 64 + 4 }}
    >
      <span className="h-px flex-1 bg-primary opacity-0 transition-none group-hover/row:opacity-100 group-focus-within/row:opacity-100" />
      <Button
        className="opacity-0 transition-none group-hover/row:opacity-100 focus-visible:opacity-100"
        size="icon-xs"
        disabled={disabled}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onInsert();
        }}
      >
        <PlusIcon />
      </Button>
      <span className="h-px flex-1 bg-primary opacity-0 transition-none group-hover/row:opacity-100 group-focus-within/row:opacity-100" />
    </div>
  );
}

function RowRemovalControl({
  row,
  disabled,
  onRemove,
}: {
  row: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <Button
      className="absolute right-3 z-30 -translate-y-1/2 opacity-0 transition-none hover:opacity-100 focus-visible:opacity-100"
      style={{ top: row * 64 + 36 }}
      variant="outline"
      size="icon-xs"
      disabled={disabled}
      aria-label={`Remove empty row ${row + 1}`}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <MinusIcon />
    </Button>
  );
}

function WidgetCatalog({
  disabled,
  hasDateControl,
  onAdd,
  onDragStart,
}: {
  disabled: boolean;
  hasDateControl: boolean;
  onAdd: (type: BuilderType) => Promise<void>;
  onDragStart: (type: BuilderType) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Drag onto the grid or click +.</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-px">
        {catalog.map(({ type, label, icon: Icon }) => {
          const unavailable = disabled || (type === 'dateControl' && hasDateControl);
          return (
            <div
              key={type}
              draggable={!unavailable}
              onDragStart={(event) => {
                onDragStart(type);
                event.dataTransfer.setData('text/plain', type);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              className="flex cursor-grab items-center gap-2 rounded-md py-0.5 pl-1.5 hover:bg-accent active:cursor-grabbing"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm">{label}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={unavailable}
                aria-label={`Add ${label}`}
                onClick={() => void onAdd(type)}
              >
                <PlusIcon />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WidgetSettings({
  dashboardId,
  dashboardDefaultDateRange,
  timezone,
  widget,
  dataSources,
  onClose,
  onChange,
  onRemoveEmptyRowAbove,
  onRemoveEmptyRowBelow,
}: {
  dashboardId: string;
  dashboardDefaultDateRange: DashboardDocument['defaultDateRange'];
  timezone: string;
  widget: DashboardWidget;
  dataSources: BuilderDataSource[];
  onClose: () => void;
  onChange: (definition: WidgetDefinition, libraryMetric?: LibraryMetricDraft) => Promise<boolean>;
  onRemoveEmptyRowAbove?: () => void;
  onRemoveEmptyRowBelow?: () => void;
}) {
  const [definition, setDefinition] = useState(widget.definition);
  const [source, setSource] = useState<SourceDescription>();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);
  const [editedField, setEditedField] = useState<DatasourceFieldRow>();
  const [settingsError, setSettingsError] = useState<string>();
  const sourceRequestRef = useRef(0);
  const definitionRef = useRef(widget.definition);
  const sourceId = 'dataSourceId' in definition ? definition.dataSourceId : undefined;
  useEffect(() => {
    definitionRef.current = widget.definition;
    setDefinition(widget.definition);
  }, [widget.definition]);
  useEffect(() => {
    sourceRequestRef.current += 1;
    setSettingsError(undefined);
  }, [widget.id]);
  useEffect(() => {
    if (!sourceId) return;
    const currentSourceId = sourceId;
    let current = true;
    async function loadSource() {
      try {
        const next = await describeSource(currentSourceId, dashboardId);
        if (current) setSource(next);
      } catch (caught) {
        if (current) setSettingsError(message(caught));
      }
    }
    void loadSource();
    return () => {
      current = false;
    };
  }, [dashboardId, sourceId]);

  async function commit(next: WidgetDefinition) {
    definitionRef.current = next;
    setDefinition(next);
    await onChange(next);
  }

  function commitMetric(next: WidgetDefinition, libraryMetric?: LibraryMetricDraft) {
    definitionRef.current = next;
    setDefinition(next);
    return onChange(next, libraryMetric);
  }

  function setLocalDefinition(next: WidgetDefinition) {
    definitionRef.current = next;
    setDefinition(next);
  }

  async function selectSource(dataSourceId: string) {
    const currentDefinition = definitionRef.current;
    if (!('dataSourceId' in currentDefinition)) return;
    const request = ++sourceRequestRef.current;
    setSettingsError(undefined);
    try {
      const next = await changeSource(
        currentDefinition,
        dataSourceId,
        dashboardId,
        () => definitionRef.current,
      );
      if (request === sourceRequestRef.current) await commit(next);
    } catch (caught) {
      if (request === sourceRequestRef.current) setSettingsError(message(caught));
    }
  }

  const fields = [...(source?.fields ?? []), ...(source?.calculatedFields ?? [])];

  /** Opens the formula editor on an existing calculated field the widget already references. */
  function editCalculatedField(fieldId: string) {
    const calculated = source?.calculatedFields.find((item) => item.id === fieldId);
    if (!calculated) return;
    setEditedField(calculatedFieldRow(calculated));
    setFieldEditorOpen(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{widgetLabel(widget)}</h2>
          <p className="text-xs text-muted-foreground">{definition.type}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close widget settings" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {onRemoveEmptyRowAbove ? (
          <Button variant="outline" size="sm" onClick={onRemoveEmptyRowAbove}>
            <MinusIcon data-icon="inline-start" />
            Remove empty row above
          </Button>
        ) : null}
        {onRemoveEmptyRowBelow ? (
          <Button variant="outline" size="sm" onClick={onRemoveEmptyRowBelow}>
            <MinusIcon data-icon="inline-start" />
            Remove empty row below
          </Button>
        ) : null}
      </div>
      {settingsError ? (
        <Alert variant="destructive">
          <AlertDescription>{settingsError}</AlertDescription>
        </Alert>
      ) : null}
      {'title' in definition ? (
        <>
          <Field>
            <FieldLabel htmlFor={`title-${widget.id}`}>Title</FieldLabel>
            <Input
              id={`title-${widget.id}`}
              value={definition.title}
              onChange={(event) => setLocalDefinition({ ...definition, title: event.target.value })}
              onBlur={() => void commit(definition)}
            />
          </Field>
          <TextStyleSettings
            legend="Title style"
            value={definition.titleStyle}
            onChange={(titleStyle) => void commit({ ...definition, titleStyle })}
          />
        </>
      ) : null}
      {definition.type === 'text' ? (
        <>
          <Field>
            <FieldLabel htmlFor={`text-${widget.id}`}>Text</FieldLabel>
            <Textarea
              id={`text-${widget.id}`}
              value={textDocument(definition.content.document)}
              readOnly={typeof definition.content.document !== 'string'}
              onChange={(event) =>
                typeof definition.content.document === 'string' &&
                setLocalDefinition({
                  ...definition,
                  content: {
                    ...definition.content,
                    document: replacePlainTextDocument(
                      definition.content.document,
                      event.target.value,
                    ),
                  },
                })
              }
              onBlur={() => {
                if (typeof definition.content.document === 'string') void commit(definition);
              }}
            />
            {typeof definition.content.document !== 'string' ? (
              <FieldDescription>
                Structured text is read-only here so its document format stays intact.
              </FieldDescription>
            ) : null}
          </Field>
          <TextStyleSettings
            legend="Text style"
            value={definition.textStyle}
            onChange={(textStyle) => void commit({ ...definition, textStyle })}
            hasFreeHeight
          />
        </>
      ) : null}
      {definition.type === 'dateControl' ? (
        <Field>
          <FieldLabel>Default range</FieldLabel>
          <DateRangePicker
            range={definition.defaultDateRange ?? dashboardDefaultDateRange}
            timezone={timezone}
            onChange={(defaultDateRange) => void commit({ ...definition, defaultDateRange })}
          />
        </Field>
      ) : null}
      {'dataSourceId' in definition ? (
        <>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <FieldPicker
                label="Source"
                value={definition.dataSourceId}
                fields={dataSources.map((item) => ({ id: item.id, label: item.name }))}
                onChange={(dataSourceId) => void selectSource(dataSourceId)}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Edit datasource fields"
              onClick={() => setSourceOpen(true)}
            >
              <PencilIcon />
            </Button>
          </div>
          {definition.type === 'control' ? (
            <FieldPicker
              label="Field"
              value={definition.fieldId}
              fields={fieldChoices(fields.filter((field) => field.role !== 'metric'))}
              onChange={(fieldId) =>
                void commit({ ...definition, fieldId, defaultValues: undefined })
              }
            />
          ) : (
            <>
              <FieldPicker
                label="Date field"
                value={definition.dateRangeFieldId}
                fields={fieldChoices(fields.filter((field) => field.semanticType === 'date'))}
                onChange={(dateRangeFieldId) => void commit({ ...definition, dateRangeFieldId })}
              />
              <DimensionSettings
                definition={definition}
                fields={fields}
                commit={commit}
                onEditCalculatedField={editCalculatedField}
              />
              <MetricSettings
                dashboardId={dashboardId}
                definition={definition}
                fields={fields}
                source={source}
                commit={commitMetric}
                onEditCalculatedField={editCalculatedField}
              />
              <FilterSettings definition={definition} fields={fields} commit={commit} />
              <TypeSettings
                definition={definition}
                fields={fields}
                source={source}
                commit={commit}
              />
              <Button
                className="justify-self-start"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditedField(undefined);
                  setFieldEditorOpen(true);
                }}
              >
                <PlusIcon data-icon="inline-start" /> New field
              </Button>
            </>
          )}
          {source ? (
            <DatasourceDialog
              open={sourceOpen}
              onOpenChange={setSourceOpen}
              dashboardId={dashboardId}
              source={source}
              onRefresh={() => describeSource(source.id, dashboardId).then(setSource)}
            />
          ) : null}
          {source ? (
            <CalculatedFieldDialog
              open={fieldEditorOpen}
              onOpenChange={setFieldEditorOpen}
              dashboardId={dashboardId}
              datasource={source}
              field={editedField}
              onSaved={() => describeSource(definition.dataSourceId, dashboardId).then(setSource)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function LayoutNumberInput({
  id,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max?: number;
  onCommit: (value: number) => Promise<void>;
}) {
  const [input, setInput] = useState(String(value));
  useEffect(() => setInput(String(value)), [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={input}
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => {
        const next = Number(input);
        if (Number.isInteger(next) && next >= min && (max === undefined || next <= max))
          void onCommit(next);
        else setInput(String(value));
      }}
    />
  );
}

function DimensionSettings({
  definition,
  fields,
  commit,
  onEditCalculatedField,
}: QuerySettingsProps & { onEditCalculatedField: (fieldId: string) => void }) {
  const dimensions = fields.filter((field) => field.role === 'dimension');
  const choices = fieldChoices(dimensions, 'Fields');
  if ('dimension' in definition) {
    const date = dimensions.find(
      (field) => field.id === definition.dimension.fieldId && field.semanticType === 'date',
    );
    return (
      <>
        <Field>
          <FieldLabel>{axisLabel('dimension', definition.type, false)}</FieldLabel>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <FieldPicker
                appearance="assignment"
                label="Dimension"
                prefix={
                  choices.find((field) => field.id === definition.dimension.fieldId)?.prefix ??
                  'ABC'
                }
                tone="dimension"
                value={definition.dimension.fieldId}
                fields={choices}
                onChange={(fieldId) =>
                  void commit({
                    ...definition,
                    dimension: dimensionForField(definition.dimension, fieldId, fields, 'auto'),
                  })
                }
              />
            </div>
            {formulaFieldId(fields, definition.dimension.fieldId) ? (
              <EditFormulaButton
                label="Edit dimension formula"
                onClick={() => onEditCalculatedField(definition.dimension.fieldId)}
              />
            ) : null}
          </div>
        </Field>
        {date ? (
          <DateGranularitySetting
            value={definition.dimension.dateGranularity ?? 'auto'}
            onChange={(dateGranularity) =>
              commit({ ...definition, dimension: { ...definition.dimension, dateGranularity } })
            }
          />
        ) : null}
      </>
    );
  }
  if ('dimensions' in definition)
    return (
      <Field>
        <FieldLabel>{axisLabel('dimension', definition.type, true)}</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {definition.dimensions.map((dimension, index) => (
            <div key={`${dimension.fieldId}-${index}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <FieldPicker
                  appearance="assignment"
                  label={`Dimension ${index + 1}`}
                  prefix={choices.find((field) => field.id === dimension.fieldId)?.prefix ?? 'ABC'}
                  tone="dimension"
                  value={dimension.fieldId}
                  fields={choices}
                  onChange={(fieldId) =>
                    void commit({
                      ...definition,
                      dimensions: definition.dimensions.map((item, itemIndex) =>
                        itemIndex === index
                          ? dimensionForField(item, fieldId, fields, 'raw')
                          : item,
                      ),
                    })
                  }
                />
                {formulaFieldId(fields, dimension.fieldId) ? (
                  <EditFormulaButton
                    label={`Edit formula for dimension ${index + 1}`}
                    onClick={() => onEditCalculatedField(dimension.fieldId)}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove dimension ${index + 1}`}
                  onClick={() =>
                    void commit({
                      ...definition,
                      dimensions: definition.dimensions.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
              {fields.find(
                (field) => field.id === dimension.fieldId && field.semanticType === 'date',
              ) ? (
                <DateGranularitySetting
                  compact
                  value={dimension.dateGranularity ?? 'raw'}
                  onChange={(dateGranularity) =>
                    commit({
                      ...definition,
                      dimensions: definition.dimensions.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, dateGranularity } : item,
                      ),
                    })
                  }
                />
              ) : null}
            </div>
          ))}
          <FieldPicker
            appearance="add"
            label="Add dimension"
            tone="dimension"
            value=""
            fields={choices}
            onChange={(fieldId) =>
              void commit({
                ...definition,
                dimensions: [
                  ...definition.dimensions,
                  dimensionForField({ fieldId }, fieldId, fields, 'raw'),
                ],
              })
            }
          />
        </div>
      </Field>
    );
  return null;
}

type DimensionDefinition = Extract<WidgetDefinition, { type: 'line' }>['dimension'];

function dimensionForField(
  dimension: DimensionDefinition,
  fieldId: string,
  fields: SourceField[],
  dateDefault: DateGranularity,
): DimensionDefinition {
  const { dateGranularity: _dateGranularity, ...rest } = dimension;
  const date = fields.some((field) => field.id === fieldId && field.semanticType === 'date');
  return date ? { ...rest, fieldId, dateGranularity: dateDefault } : { ...rest, fieldId };
}

const textStyleFields = [
  {
    key: 'size',
    label: 'Size',
    // Short labels because each option renders at its own size, so a long word would overflow the
    // popup at the larger steps. The preview carries the meaning, not the wording.
    options: { xs: 'XS', sm: 'S', base: 'M', lg: 'L', xl: 'XL', '2xl': '2XL' },
  },
  {
    key: 'weight',
    label: 'Weight',
    options: { normal: 'Normal', medium: 'Medium', semibold: 'Semibold', bold: 'Bold' },
  },
  { key: 'transform', label: 'Case', options: { none: 'As typed', uppercase: 'Uppercase' } },
  { key: 'align', label: 'Align', options: { left: 'Left', center: 'Center', right: 'Right' } },
  {
    key: 'verticalAlign',
    label: 'Vertical',
    options: { top: 'Top', center: 'Middle', bottom: 'Bottom' },
    needsFreeHeight: true,
  },
  {
    key: 'tone',
    label: 'Tone',
    options: { default: 'Normal', muted: 'Muted', primary: 'Accent' },
    // A swatch rather than coloured label text: the highlighted option recolours its own text and
    // every descendant, which would hide exactly the preview the user is looking at.
    swatches: { default: 'bg-foreground', muted: 'bg-muted-foreground', primary: 'bg-primary' },
  },
] as const satisfies ReadonlyArray<{
  key: keyof TextStyle;
  label: string;
  options: Record<string, string>;
  swatches?: Record<string, string>;
  // Set on properties that only make sense when the element can grow taller than its text.
  needsFreeHeight?: boolean;
}>;

// The option previews itself by running through the same mapping that styles the real widget, so a
// preview can never drift from the render. Unknown values (the unset "Default") produce no classes.
function textStylePreview(key: keyof TextStyle, option: string) {
  const parsed = textStyleSchema.safeParse({ [key]: option });
  return parsed.success ? textStyleClasses(parsed.data) : undefined;
}

/**
 * Presentation controls for a text widget or a card title. Every property can stay unset, in which
 * case the widget renders with the app defaults, and a style with nothing set is stored as absent.
 */
function TextStyleSettings({
  legend,
  value,
  onChange,
  hasFreeHeight = false,
}: {
  legend: string;
  value: TextStyle | undefined;
  onChange: (style: TextStyle | undefined) => void;
  /** Whether the styled element fills its widget, which is what makes vertical alignment do anything. */
  hasFreeHeight?: boolean;
}) {
  const update = (key: keyof TextStyle, selected: string | null) => {
    const draft: Record<string, string | undefined> = { ...value };
    if (selected) draft[key] = selected;
    else delete draft[key];
    const parsed = textStyleSchema.safeParse(draft);
    onChange(parsed.success && Object.keys(draft).length ? parsed.data : undefined);
  };
  return (
    <Field>
      <FieldLabel>{legend}</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        {textStyleFields
          .filter((setting) => hasFreeHeight || !('needsFreeHeight' in setting))
          .map((setting) => {
            const options: Record<string, string> = setting.options;
            const swatches: Record<string, string> | undefined =
              'swatches' in setting ? setting.swatches : undefined;
            // `w-full` is what lets the align preview work: the label fills the row, so `text-right`
            // actually moves it. The other properties are unaffected by the extra width.
            const optionContent = (option: string, preview: boolean) => (
              <>
                {/* The empty slot for the unset option keeps every label in the list on one line. */}
                {swatches ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      swatches[option] ?? 'bg-transparent',
                    )}
                  />
                ) : null}
                <span className={cn('w-full', preview && textStylePreview(setting.key, option))}>
                  {options[option] ?? 'Default'}
                </span>
              </>
            );
            return (
              <div key={setting.key} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{setting.label}</span>
                <Select
                  value={value?.[setting.key] ?? ''}
                  onValueChange={(selected) => update(setting.key, selected)}
                >
                  <SelectTrigger
                    aria-label={`${legend}: ${setting.label.toLowerCase()}`}
                    className="w-full"
                  >
                    {/* The trigger stays at the control's own size so the two columns keep an even
                      height. Only the options preview themselves. */}
                    <SelectValue>
                      {(selected: string | null) => optionContent(selected ?? '', false)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-40" align="start" alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value="">{optionContent('', false)}</SelectItem>
                      {Object.keys(options).map((option) => (
                        <SelectItem key={option} value={option}>
                          {optionContent(option, true)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
      </div>
    </Field>
  );
}

function DateGranularitySetting({
  value,
  onChange,
  compact = false,
}: {
  value: DateGranularity;
  onChange: (value: DateGranularity) => Promise<void>;
  compact?: boolean;
}) {
  const select = (
    <NativeSelect
      aria-label={compact ? 'Date granularity' : undefined}
      value={value}
      onChange={(event) => void onChange(event.target.value as DateGranularity)}
    >
      <NativeSelectOption value="auto">Automatic</NativeSelectOption>
      <NativeSelectOption value="raw">Raw values</NativeSelectOption>
      <NativeSelectOption value="day">Day</NativeSelectOption>
      <NativeSelectOption value="week">Week</NativeSelectOption>
      <NativeSelectOption value="month">Month</NativeSelectOption>
      <NativeSelectOption value="quarter">Quarter</NativeSelectOption>
      <NativeSelectOption value="year">Year</NativeSelectOption>
    </NativeSelect>
  );
  if (compact) return select;
  return (
    <Field>
      <FieldLabel>Date granularity</FieldLabel>
      {select}
    </Field>
  );
}

function MetricSettings({
  definition,
  fields,
  source,
  commit,
  dashboardId,
  onEditCalculatedField,
}: Omit<QuerySettingsProps, 'commit'> & {
  dashboardId: string;
  source?: SourceDescription;
  commit: (definition: WidgetDefinition, libraryMetric?: LibraryMetricDraft) => Promise<boolean>;
  onEditCalculatedField: (fieldId: string) => void;
}) {
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [editedIndex, setEditedIndex] = useState<number>();
  const choices = [
    ...fieldChoices(
      fields.filter((field) => field.role === 'metric'),
      'Fields',
    ),
    ...(source?.libraryMetrics ?? []).map((item) => ({
      id: item.id,
      label: item.name,
      group: 'Metric library',
      prefix: 'fx',
    })),
  ];
  const metrics =
    'metric' in definition
      ? [definition.metric]
      : 'metrics' in definition
        ? definition.metrics
        : [];
  if (!metrics.length) return null;
  function update(index: number, nextMetric: WidgetMetric) {
    if ('metric' in definition) return commit({ ...definition, metric: nextMetric });
    if ('metrics' in definition)
      return commit({
        ...definition,
        metrics: definition.metrics.map((item, itemIndex) =>
          itemIndex === index ? nextMetric : item,
        ),
      });
    return Promise.resolve(false);
  }
  function addMetric(next: WidgetMetric, libraryMetric?: LibraryMetricDraft) {
    if ('metric' in definition) return commit({ ...definition, metric: next }, libraryMetric);
    if ('metrics' in definition)
      return commit({ ...definition, metrics: [...definition.metrics, next] }, libraryMetric);
    return Promise.resolve(false);
  }
  function metricFor(id: string): WidgetMetric {
    const library = source?.libraryMetrics.find((item) => item.id === id);
    const field = fields.find((item) => item.id === id);
    return {
      source: library
        ? { kind: 'library', libraryMetricId: id }
        : {
            kind: 'field',
            fieldId: id,
            aggregation: field?.defaultAggregation ?? 'sum',
          },
      dataType:
        (field?.semanticType ?? library?.semanticType) === 'currency'
          ? 'currency'
          : (field?.semanticType ?? library?.semanticType) === 'ratio'
            ? 'percent'
            : 'number',
    };
  }
  return (
    <>
      <Field>
        <FieldLabel>{axisLabel('metric', definition.type, metrics.length > 1)}</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {metrics.map((metric, index) => {
            const value =
              metric.source.kind === 'field'
                ? metric.source.fieldId
                : metric.source.kind === 'library'
                  ? metric.source.libraryMetricId
                  : `expression:${index}`;
            const metricChoices =
              metric.source.kind === 'expression'
                ? [
                    {
                      id: value,
                      label: metric.userDefinedName ?? 'Custom expression',
                      group: 'Chart metrics',
                      prefix: 'fx',
                    },
                    ...choices,
                  ]
                : choices;
            return (
              <div key={`${value}-${index}`} className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <div className="flex h-8 min-w-0 flex-1 overflow-hidden rounded-full border border-metric/40 bg-metric/10">
                    {metric.source.kind === 'field' ? (
                      <Select
                        value={metric.source.aggregation}
                        onValueChange={(aggregation) => {
                          if (!aggregation) return;
                          void update(index, {
                            ...metric,
                            source: {
                              kind: 'field',
                              fieldId: metric.source.kind === 'field' ? metric.source.fieldId : '',
                              aggregation,
                            },
                          });
                        }}
                      >
                        <SelectTrigger
                          aria-label={`Aggregation for metric ${index + 1}`}
                          className="w-28 shrink-0"
                          variant="embedded"
                        >
                          <SelectValue>
                            {(aggregation: Aggregation | null) => {
                              if (!aggregation) return null;
                              const Icon = aggregationIcons[aggregation];
                              return (
                                <>
                                  <Icon />
                                  {aggregationLabel(aggregation)}
                                </>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          className="min-w-40"
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <SelectGroup>
                            {aggregations.map((item) => {
                              const Icon = aggregationIcons[item];
                              return (
                                <Tooltip key={item}>
                                  <TooltipTrigger
                                    render={<SelectItem className="pr-16" value={item} />}
                                  >
                                    <Icon />
                                    <span>{aggregationLabel(item)}</span>
                                    <CircleHelpIcon
                                      data-slot="aggregation-help"
                                      className="absolute right-8"
                                      aria-hidden="true"
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    {aggregationDescriptions[item]}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="flex w-12 shrink-0 items-center justify-center border-r border-metric/30 font-mono text-xs font-semibold text-muted-foreground">
                        fx
                      </span>
                    )}
                    <FieldPicker
                      appearance="embedded"
                      label={`Metric${metrics.length > 1 ? ` ${index + 1}` : ''}`}
                      tone="metric"
                      value={value}
                      fields={metricChoices}
                      onCreate={{ label: 'Add custom metric', action: () => setFormulaOpen(true) }}
                      onChange={(id) => {
                        if (id !== value) void update(index, metricFor(id));
                      }}
                    />
                  </div>
                  {metric.source.kind === 'expression' ? (
                    <EditFormulaButton
                      label={`Edit formula for metric ${index + 1}`}
                      onClick={() => setEditedIndex(index)}
                    />
                  ) : formulaFieldId(fields, value) ? (
                    <EditFormulaButton
                      label={`Edit formula for metric ${index + 1}`}
                      onClick={() => onEditCalculatedField(value)}
                    />
                  ) : null}
                  {'metrics' in definition && definition.metrics.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove metric ${index + 1}`}
                      onClick={() =>
                        void commit({
                          ...definition,
                          metrics: definition.metrics.filter((_, itemIndex) => itemIndex !== index),
                        })
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
                {definition.type === 'table' ? (
                  <ConditionalFormatSettings
                    metric={metric}
                    onChange={async (conditionalFormat) => {
                      await update(index, { ...metric, conditionalFormat });
                    }}
                  />
                ) : null}
              </div>
            );
          })}
          {'metrics' in definition ? (
            <FieldPicker
              appearance="add"
              label="Add metric"
              tone="metric"
              value=""
              fields={choices}
              onCreate={{ label: 'Add custom metric', action: () => setFormulaOpen(true) }}
              onChange={(id) => void addMetric(metricFor(id))}
            />
          ) : null}
        </div>
      </Field>
      <MetricFormulaDialog
        open={formulaOpen || editedIndex !== undefined}
        onOpenChange={(next) => {
          if (next) return;
          setFormulaOpen(false);
          setEditedIndex(undefined);
        }}
        dashboardId={dashboardId}
        source={source}
        metric={editedIndex === undefined ? undefined : metrics[editedIndex]}
        onSave={(next, libraryMetric) =>
          editedIndex === undefined ? addMetric(next, libraryMetric) : update(editedIndex, next)
        }
      />
    </>
  );
}

type ConditionalFormat = NonNullable<WidgetMetric['conditionalFormat']>;

function ConditionalFormatSettings({
  metric,
  onChange,
}: {
  metric: WidgetMetric;
  onChange: (rules: ConditionalFormat | undefined) => Promise<void>;
}) {
  const rules = metric.conditionalFormat ?? [];
  const update = (index: number, rule: ConditionalFormat[number]) =>
    onChange(rules.map((item, itemIndex) => (itemIndex === index ? rule : item)));
  return (
    <div className="grid gap-2 pl-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Conditional formatting</FieldLabel>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            void onChange([...rules, { comparator: 'gte', value: 0, color: 'positive' }])
          }
        >
          <PlusIcon data-icon="inline-start" /> Add rule
        </Button>
      </div>
      {rules.map((rule, index) => (
        <div key={index} className="grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-1">
          <NativeSelect
            aria-label={`Rule ${index + 1} comparator`}
            value={rule.comparator}
            onChange={(event) => {
              const comparator = event.target.value;
              void update(
                index,
                comparator === 'between'
                  ? { comparator, min: 0, max: 100, color: rule.color }
                  : {
                      comparator: comparator as 'gt' | 'lt' | 'gte' | 'lte',
                      value: 'value' in rule ? rule.value : rule.min,
                      color: rule.color,
                    },
              );
            }}
          >
            <NativeSelectOption value="gt">Greater than</NativeSelectOption>
            <NativeSelectOption value="gte">At least</NativeSelectOption>
            <NativeSelectOption value="lt">Less than</NativeSelectOption>
            <NativeSelectOption value="lte">At most</NativeSelectOption>
            <NativeSelectOption value="between">Between</NativeSelectOption>
          </NativeSelect>
          <ThresholdInputs rule={rule} onChange={(next) => update(index, next)} />
          <NativeSelect
            aria-label={`Rule ${index + 1} color`}
            value={rule.color}
            onChange={(event) =>
              void update(index, {
                ...rule,
                color: event.target.value as ConditionalFormat[number]['color'],
              })
            }
          >
            <NativeSelectOption value="positive">Positive</NativeSelectOption>
            <NativeSelectOption value="warning">Warning</NativeSelectOption>
            <NativeSelectOption value="negative">Negative</NativeSelectOption>
            <NativeSelectOption value="neutral">Neutral</NativeSelectOption>
          </NativeSelect>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove rule ${index + 1}`}
            onClick={() => {
              const next = rules.filter((_, itemIndex) => itemIndex !== index);
              void onChange(next.length ? next : undefined);
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ThresholdInputs({
  rule,
  onChange,
}: {
  rule: ConditionalFormat[number];
  onChange: (rule: ConditionalFormat[number]) => Promise<void>;
}) {
  if (rule.comparator === 'between')
    return (
      <div className="flex gap-1">
        <Input
          aria-label="Minimum"
          type="number"
          defaultValue={rule.min}
          onBlur={(event) => void onChange({ ...rule, min: Number(event.currentTarget.value) })}
        />
        <Input
          aria-label="Maximum"
          type="number"
          defaultValue={rule.max}
          onBlur={(event) => void onChange({ ...rule, max: Number(event.currentTarget.value) })}
        />
      </div>
    );
  return (
    <Input
      aria-label="Threshold"
      type="number"
      defaultValue={rule.value}
      onBlur={(event) => void onChange({ ...rule, value: Number(event.currentTarget.value) })}
    />
  );
}

const aggregations: Aggregation[] = [
  'sum',
  'average',
  'count',
  'countDistinct',
  'min',
  'max',
  'median',
  'standardDeviation',
  'variance',
];

const aggregationLabels: Record<Aggregation, string> = {
  sum: 'SUM',
  average: 'AVG',
  count: 'COUNT',
  countDistinct: 'COUNTD',
  min: 'MIN',
  max: 'MAX',
  median: 'MEDIAN',
  standardDeviation: 'STDDEV',
  variance: 'VAR',
};

const aggregationIcons: Record<Aggregation, LucideIcon> = {
  sum: SigmaIcon,
  average: CircleDivideIcon,
  count: HashIcon,
  countDistinct: FingerprintIcon,
  min: ArrowDownToLineIcon,
  max: ArrowUpToLineIcon,
  median: AlignCenterVerticalIcon,
  standardDeviation: ActivityIcon,
  variance: ChartScatterIcon,
};

const aggregationDescriptions: Record<Aggregation, string> = {
  sum: 'Adds all non-null values in each group.',
  average: 'Returns the arithmetic mean of all non-null values.',
  count: 'Counts rows where this field is not null.',
  countDistinct: 'Counts unique non-null values.',
  min: 'Returns the smallest non-null value.',
  max: 'Returns the largest non-null value.',
  median: 'Returns the middle non-null value after sorting.',
  standardDeviation: 'Measures spread using the sample standard deviation.',
  variance: 'Measures squared spread using the sample variance.',
};

function aggregationLabel(aggregation: Aggregation) {
  return aggregationLabels[aggregation];
}

function fieldTypePrefix(type: SemanticType) {
  if (type === 'date') return 'DATE';
  if (type === 'text') return 'ABC';
  if (type === 'id') return 'ID';
  return '123';
}

/** Calculated fields carry a formula, so they read as fx instead of their value type. */
function fieldPrefix(field: SourceField) {
  return 'expression' in field ? 'fx' : fieldTypePrefix(field.semanticType);
}

function fieldChoices(fields: SourceField[], group?: string) {
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    group,
    prefix: fieldPrefix(field),
  }));
}

/** Returns the id back when it points at a calculated field, so callers can offer an edit. */
function formulaFieldId(fields: SourceField[], fieldId: string) {
  const field = fields.find((item) => item.id === fieldId);
  return field && 'expression' in field ? field.id : undefined;
}

function EditFormulaButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}
      >
        <SquareFunctionIcon />
      </TooltipTrigger>
      <TooltipContent>Edit formula</TooltipContent>
    </Tooltip>
  );
}

function axisLabel(role: 'dimension' | 'metric', type: WidgetDefinition['type'], plural: boolean) {
  const label = `${role === 'dimension' ? 'Dimension' : 'Metric'}${plural ? 's' : ''}`;
  if (type === 'line' || type === 'bar')
    return `${label} · ${role === 'dimension' ? 'X' : 'Y'} axis`;
  return label;
}

type QueryDefinition = Extract<WidgetDefinition, { dataSourceId: string }>;
interface QuerySettingsProps {
  definition: QueryDefinition;
  fields: SourceField[];
  commit: (definition: WidgetDefinition) => Promise<void>;
}

function FilterSettings({ definition, fields, commit }: QuerySettingsProps) {
  const filter = definition.filter;
  const conditions = filter?.conditions ?? [];
  function updateCondition(index: number, patch: Partial<(typeof conditions)[number]>) {
    const currentFilter = filter ?? { connector: 'and' as const, conditions };
    return commit({
      ...definition,
      filter: patchFilterCondition(currentFilter, index, patch),
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Filters</FieldLabel>
        {conditions.length > 1 ? (
          <NativeSelect
            className="w-24"
            aria-label="Filter connector"
            value={filter?.connector ?? 'and'}
            onChange={(event) =>
              void commit({
                ...definition,
                filter: {
                  connector: event.target.value as 'and' | 'or',
                  conditions,
                },
              })
            }
          >
            <NativeSelectOption value="and">Match all</NativeSelectOption>
            <NativeSelectOption value="or">Match any</NativeSelectOption>
          </NativeSelect>
        ) : null}
      </div>
      {conditions.map((condition, index) => (
        <div key={`${condition.fieldId}-${index}`} className="grid gap-2 border-l-2 pl-3">
          <FieldPicker
            label={`Filter ${index + 1}`}
            value={condition.fieldId}
            fields={fieldChoices(fields)}
            onChange={(fieldId) => void updateCondition(index, { fieldId })}
          />
          <NativeSelect
            aria-label={`Filter ${index + 1} operator`}
            value={condition.operator}
            onChange={(event) =>
              void updateCondition(index, {
                operator: event.target.value as typeof condition.operator,
              })
            }
          >
            {filterOperators.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {!['isEmpty', 'isNotEmpty'].includes(condition.operator) ? (
            <FilterValueInput
              value={filterInputValue(
                condition.value,
                condition.operator === 'in' || condition.operator === 'notIn',
              )}
              onCommit={(value) =>
                updateCondition(index, {
                  value: filterValueFromInput(
                    value,
                    condition.operator === 'in' || condition.operator === 'notIn',
                  ),
                })
              }
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = conditions.filter((_, itemIndex) => itemIndex !== index);
              void commit({
                ...definition,
                filter: next.length
                  ? { connector: filter?.connector ?? 'and', conditions: next }
                  : undefined,
              });
            }}
          >
            Remove filter
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          fields[0] &&
          void commit({
            ...definition,
            filter: {
              connector: filter?.connector ?? 'and',
              conditions: [...conditions, { fieldId: fields[0].id, operator: 'equals', value: '' }],
            },
          })
        }
      >
        <PlusIcon data-icon="inline-start" /> Add filter
      </Button>
    </div>
  );
}

const filterOperators = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'in',
  'notIn',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'isEmpty',
  'isNotEmpty',
] as const;

function FilterValueInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => Promise<void>;
}) {
  const [input, setInput] = useState(value);
  useEffect(() => setInput(value), [value]);
  return (
    <Input
      value={input}
      placeholder="Value"
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => void onCommit(input)}
    />
  );
}

function TypeSettings({
  definition,
  fields,
  source,
  commit,
}: QuerySettingsProps & { source?: SourceDescription }) {
  const dimensions = fields.filter(
    (field) => field.role === 'dimension' && field.semanticType !== 'date',
  );
  switch (definition.type) {
    case 'scorecard':
    case 'line':
      return (
        <ComparisonSetting
          value={definition.comparison?.mode ?? 'none'}
          onChange={(mode) => commit({ ...definition, comparison: { mode } })}
        />
      );
    case 'gauge':
      return (
        <>
          <ComparisonSetting
            value={definition.comparison?.mode ?? 'none'}
            onChange={(mode) => commit({ ...definition, comparison: { mode } })}
          />
          <Field>
            <FieldLabel>Upper limit</FieldLabel>
            <NativeSelect
              value={definition.upperLimit?.kind ?? 'none'}
              onChange={(event) => {
                const kind = event.target.value;
                if (kind === 'manual') {
                  void commit({ ...definition, upperLimit: { kind, value: 100 } });
                  return;
                }
                if (kind === 'library') {
                  const libraryMetricId = source?.libraryMetrics[0]?.id;
                  if (!libraryMetricId) return;
                  void commit({ ...definition, upperLimit: { kind, libraryMetricId } });
                  return;
                }
                void commit({ ...definition, upperLimit: undefined });
              }}
            >
              <NativeSelectOption value="none">Automatic</NativeSelectOption>
              <NativeSelectOption value="manual">Manual</NativeSelectOption>
              {source?.libraryMetrics.length || definition.upperLimit?.kind === 'library' ? (
                <NativeSelectOption value="library">Library metric</NativeSelectOption>
              ) : null}
            </NativeSelect>
          </Field>
          {definition.upperLimit?.kind === 'manual' ? (
            <Field>
              <FieldLabel htmlFor="gauge-upper-limit">Maximum</FieldLabel>
              <LayoutNumberInput
                id="gauge-upper-limit"
                min={1}
                value={definition.upperLimit.value}
                onCommit={(value) =>
                  commit({ ...definition, upperLimit: { kind: 'manual', value } })
                }
              />
            </Field>
          ) : null}
          {definition.upperLimit?.kind === 'library' ? (
            <Field>
              <FieldLabel htmlFor="gauge-upper-limit-metric">Maximum metric</FieldLabel>
              <NativeSelect
                id="gauge-upper-limit-metric"
                value={definition.upperLimit.libraryMetricId}
                onChange={(event) =>
                  void commit({
                    ...definition,
                    upperLimit: {
                      kind: 'library',
                      libraryMetricId: event.target.value,
                    },
                  })
                }
              >
                {source?.libraryMetrics.map((metric) => (
                  <NativeSelectOption key={metric.id} value={metric.id}>
                    {metric.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </>
      );
    case 'bar':
      return (
        <>
          <ComparisonSetting
            value={definition.comparison?.mode ?? 'none'}
            onChange={(mode) => commit({ ...definition, comparison: { mode } })}
          />
          <BreakdownSetting
            value={definition.breakdownDimension?.fieldId ?? ''}
            fields={dimensions}
            onChange={(fieldId) =>
              commit({ ...definition, breakdownDimension: fieldId ? { fieldId } : undefined })
            }
          />
          {/* A breakdown or a comparison already spends the palette on series, so the choice is
              only offered while the chart draws a single series. */}
          {!definition.breakdownDimension && (definition.comparison?.mode ?? 'none') === 'none' ? (
            <ColorBySetting
              value={definition.colorBy ?? 'series'}
              onChange={(colorBy) => commit({ ...definition, colorBy })}
            />
          ) : null}
          <LimitSetting
            value={definition.limit ?? 20}
            onChange={(limit) => commit({ ...definition, limit })}
          />
          <SortSetting
            value={definition.sort?.[0]?.direction ?? 'desc'}
            onChange={(direction) =>
              commit({
                ...definition,
                sort: sortWithDirection(definition.sort, direction),
              })
            }
          />
        </>
      );
    case 'pie':
      return (
        <>
          <BreakdownSetting
            value={definition.breakdownDimension?.fieldId ?? ''}
            fields={dimensions}
            onChange={(fieldId) =>
              commit({ ...definition, breakdownDimension: fieldId ? { fieldId } : undefined })
            }
          />
          <LimitSetting
            value={definition.limit ?? 20}
            onChange={(limit) => commit({ ...definition, limit })}
          />
          <SortSetting
            value={definition.sort?.[0]?.direction ?? 'desc'}
            onChange={(direction) =>
              commit({
                ...definition,
                sort: sortWithDirection(definition.sort, direction),
              })
            }
          />
        </>
      );
    case 'table':
      return (
        <>
          <ComparisonSetting
            value={definition.comparison?.mode ?? 'none'}
            onChange={(mode) => commit({ ...definition, comparison: { mode } })}
          />
          <LimitSetting
            label="Result limit"
            value={definition.resultLimit.amount}
            onChange={(amount) =>
              commit({ ...definition, resultLimit: { ...definition.resultLimit, amount } })
            }
          />
          <SortSetting
            value={definition.sort?.[0]?.direction ?? 'desc'}
            onChange={(direction) =>
              commit({
                ...definition,
                sort: sortWithDirection(definition.sort, direction),
              })
            }
          />
          <FieldPicker
            label="Pivot columns"
            value={definition.pivotDimension?.fieldId ?? ''}
            fields={[
              { id: '', label: 'None' },
              ...dimensions.filter(
                (field) => !definition.dimensions.some((item) => item.fieldId === field.id),
              ),
            ]}
            onChange={(fieldId) =>
              void commit({
                ...definition,
                pivotDimension: fieldId ? { fieldId } : undefined,
              })
            }
          />
          <Field orientation="horizontal">
            <FieldLabel>Show subtotals</FieldLabel>
            <Switch
              checked={definition.showSubtotals ?? false}
              disabled={definition.dimensions.length < 2}
              onCheckedChange={(showSubtotals) => void commit({ ...definition, showSubtotals })}
            />
            {definition.dimensions.length < 2 ? (
              <FieldDescription>Add a second dimension to group rows.</FieldDescription>
            ) : null}
          </Field>
        </>
      );
    default:
      return null;
  }
}

type ComparisonMode = 'none' | 'previousPeriod' | 'previousYear';

function ComparisonSetting({
  value,
  onChange,
}: {
  value: ComparisonMode;
  onChange: (value: ComparisonMode) => Promise<void>;
}) {
  return (
    <Field>
      <FieldLabel>Comparison</FieldLabel>
      <NativeSelect
        value={value}
        onChange={(event) => void onChange(event.target.value as ComparisonMode)}
      >
        <NativeSelectOption value="none">None</NativeSelectOption>
        <NativeSelectOption value="previousPeriod">Previous period</NativeSelectOption>
        <NativeSelectOption value="previousYear">Previous year</NativeSelectOption>
      </NativeSelect>
    </Field>
  );
}

function BreakdownSetting({
  value,
  fields,
  onChange,
}: {
  value: string;
  fields: SourceField[];
  onChange: (value: string) => Promise<void>;
}) {
  return (
    <FieldPicker
      label="Breakdown"
      value={value}
      fields={[{ id: '', label: 'None' }, ...fields]}
      onChange={(fieldId) => void onChange(fieldId)}
    />
  );
}

function LimitSetting({
  label = 'Limit',
  value,
  onChange,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => Promise<void>;
}) {
  const id = `type-${label.toLocaleLowerCase().replaceAll(' ', '-')}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <LayoutNumberInput id={id} min={1} max={500} value={value} onCommit={onChange} />
    </Field>
  );
}

/**
 * Bar charts colour per series, which leaves a single-series chart in one colour. This offers the
 * alternative of a palette slot per bar.
 */
function ColorBySetting({
  value,
  onChange,
}: {
  value: BarColorBy;
  onChange: (value: BarColorBy) => Promise<void>;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="bar-color-by">Color by</FieldLabel>
      <NativeSelect
        id="bar-color-by"
        value={value}
        onChange={(event) => void onChange(event.target.value as BarColorBy)}
      >
        <NativeSelectOption value="series">Metric</NativeSelectOption>
        <NativeSelectOption value="category">Bar</NativeSelectOption>
      </NativeSelect>
    </Field>
  );
}

function SortSetting({
  value,
  onChange,
}: {
  value: 'asc' | 'desc';
  onChange: (value: 'asc' | 'desc') => Promise<void>;
}) {
  return (
    <Field>
      <FieldLabel>Sort</FieldLabel>
      <NativeSelect
        value={value}
        onChange={(event) => void onChange(event.target.value as 'asc' | 'desc')}
      >
        <NativeSelectOption value="desc">Highest first</NativeSelectOption>
        <NativeSelectOption value="asc">Lowest first</NativeSelectOption>
      </NativeSelect>
    </Field>
  );
}

type SortDefinition = Extract<WidgetDefinition, { type: 'table' }>['sort'];

function sortWithDirection(sort: SortDefinition, direction: 'asc' | 'desc') {
  return [
    {
      ...(sort?.[0] ?? { target: { kind: 'metric' as const, index: 0 } }),
      direction,
    },
    ...(sort?.slice(1) ?? []),
  ];
}

function FieldPicker({
  label,
  value,
  fields,
  onChange,
  appearance = 'default',
  tone,
  prefix,
  onCreate,
}: {
  label: string;
  value: string;
  fields: Array<{ id: string; label: string; group?: string; prefix?: string }>;
  onChange: (value: string) => void;
  appearance?: 'default' | 'assignment' | 'embedded' | 'add';
  tone?: 'dimension' | 'metric';
  prefix?: string;
  onCreate?: { label: string; action: () => void };
}) {
  const [open, setOpen] = useState(false);
  const selected = fields.find((field) => field.id === value);
  const groups = [...new Set(fields.map((field) => field.group ?? ''))];
  const compact = appearance !== 'default';
  return (
    <Field className={cn(compact && 'min-w-0 gap-0', appearance === 'embedded' && 'flex-1')}>
      <FieldLabel className={cn(compact && 'sr-only')}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant={appearance === 'default' || appearance === 'add' ? 'outline' : 'ghost'}
              className={cn(
                'w-full font-normal',
                appearance === 'default' && 'justify-between',
                appearance === 'assignment' && 'h-8 justify-start overflow-hidden rounded-full p-0',
                appearance === 'assignment' &&
                  tone === 'dimension' &&
                  'border border-dimension/40 bg-dimension/10 hover:bg-dimension/15',
                appearance === 'assignment' &&
                  tone === 'metric' &&
                  'border border-metric/40 bg-metric/10 hover:bg-metric/15',
                appearance === 'embedded' &&
                  'h-full min-w-0 justify-start rounded-none bg-transparent px-2 hover:bg-metric/10',
                appearance === 'add' &&
                  'h-8 justify-start rounded-full border-dashed text-muted-foreground',
              )}
            />
          }
        >
          {appearance === 'add' ? (
            <>
              <PlusIcon data-icon="inline-start" />
              {label}
            </>
          ) : (
            <>
              {appearance === 'assignment' && prefix ? (
                <span
                  className={cn(
                    'flex h-full shrink-0 items-center border-r px-2 font-mono text-xs font-semibold text-muted-foreground',
                    tone === 'dimension' ? 'border-dimension/30' : 'border-metric/30',
                  )}
                >
                  {prefix}
                </span>
              ) : null}
              <span className={cn('truncate', appearance === 'assignment' && 'px-2')}>
                {selected?.label ?? `Select ${label.toLocaleLowerCase()}`}
              </span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" align="start">
          <Command label={label}>
            <CommandInput placeholder={`Search ${label.toLocaleLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No matching field.</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group || 'fields'} heading={group || undefined}>
                  {fields
                    .filter((field) => (field.group ?? '') === group)
                    .map((field) => (
                      <CommandItem
                        key={field.id || 'empty'}
                        value={`${field.label} ${field.id}`}
                        className={cn(
                          tone && 'my-1 rounded-full border',
                          tone === 'dimension' &&
                            'border-dimension/30 bg-dimension/10 data-selected:bg-dimension/20',
                          tone === 'metric' &&
                            'border-metric/30 bg-metric/10 data-selected:bg-metric/20',
                        )}
                        data-checked={field.id === value}
                        onSelect={() => {
                          onChange(field.id);
                          setOpen(false);
                        }}
                      >
                        {field.prefix ? (
                          <span className="w-10 shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                            {field.prefix}
                          </span>
                        ) : null}
                        <span className="truncate">{field.label}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
              {onCreate ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value={onCreate.label}
                      onSelect={() => {
                        setOpen(false);
                        onCreate.action();
                      }}
                    >
                      <PlusIcon />
                      {onCreate.label}
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
}

function DatasourceDialog({
  open,
  onOpenChange,
  dashboardId,
  source,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  source: SourceDescription;
  onRefresh: () => Promise<void>;
}) {
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [editingField, setEditingField] = useState<DatasourceFieldRow>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{source.name} fields</DialogTitle>
          <DialogDescription>
            Editors can change labels, roles, types, and descriptions. Hiding, casting, and
            canonical names remain admin-only.
          </DialogDescription>
        </DialogHeader>
        <Button
          className="justify-self-start"
          variant="outline"
          size="sm"
          onClick={() => setNewFieldOpen(true)}
        >
          <PlusIcon data-icon="inline-start" /> New field
        </Button>
        <div className="flex flex-col gap-2">
          {source.fields.map((field) => (
            <DatasourceFieldRow
              key={field.id}
              field={field}
              sourceId={source.id}
              dashboardId={dashboardId}
              onSaved={onRefresh}
            />
          ))}
          {source.calculatedFields.map((field) => (
            <div
              key={field.id}
              className={cn(
                'flex items-center gap-3 border-l-4 bg-muted/60 p-3',
                fieldRoleStyles[field.role],
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{field.label}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {field.expression}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingField(calculatedFieldRow(field))}
              >
                Edit
              </Button>
            </div>
          ))}
        </div>
        {source.libraryMetrics.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Library metrics</h3>
            {source.libraryMetrics.map((metric) => (
              <div
                key={metric.id}
                className="grid gap-1 rounded-lg bg-muted p-3 sm:grid-cols-[12rem_1fr]"
              >
                <span className="font-medium">{metric.name}</span>
                <code className="text-xs">{metric.expression}</code>
              </div>
            ))}
          </div>
        ) : null}
        <CalculatedFieldDialog
          open={newFieldOpen}
          onOpenChange={setNewFieldOpen}
          dashboardId={dashboardId}
          datasource={source}
          onSaved={onRefresh}
        />
        <CalculatedFieldDialog
          open={Boolean(editingField)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditingField(undefined);
          }}
          dashboardId={dashboardId}
          datasource={source}
          field={editingField}
          onSaved={onRefresh}
        />
      </DialogContent>
    </Dialog>
  );
}

function DatasourceFieldRow({
  field,
  sourceId,
  dashboardId,
  onSaved,
}: {
  field: SourceField;
  sourceId: string;
  dashboardId: string;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(field);
  const [saveError, setSaveError] = useState<string>();
  const [savingField, setSavingField] = useState(false);
  const savingRef = useRef(false);
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingField(true);
    setSaveError(undefined);
    try {
      if ('columnName' in field)
        await callApi({
          action: 'updateFieldMetadata',
          dashboardId,
          dataSourceId: sourceId,
          columnName: field.columnName,
          patch: {
            label: value.label,
            role: value.role,
            semanticType: value.semanticType,
            defaultAggregation: value.defaultAggregation ?? null,
            description: value.description ?? null,
          },
        });
      else
        await callApi({
          action: 'upsertCalculatedField',
          dashboardId,
          dataSourceId: sourceId,
          id: field.id,
          name: value.label,
          canonicalName: value.canonicalName,
          expression: field.expression,
          role: value.role,
          semanticType: value.semanticType,
          defaultAggregation: value.defaultAggregation ?? null,
          description: value.description ?? undefined,
        });
      await onSaved();
    } catch (caught) {
      setSaveError(message(caught));
    } finally {
      savingRef.current = false;
      setSavingField(false);
    }
  }
  return (
    <div
      className={cn(
        'grid items-end gap-2 border-l-4 bg-muted/60 p-3 sm:grid-cols-[minmax(8rem,1fr)_8rem_9rem_9rem_minmax(10rem,1fr)_auto]',
        fieldRoleStyles[value.role],
      )}
    >
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input
          value={value.label}
          onChange={(event) => setValue({ ...value, label: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>Role</FieldLabel>
        <NativeSelect
          value={value.role}
          onChange={(event) => setValue({ ...value, role: event.target.value as FieldRole })}
        >
          {fieldRoleSchema.options.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {item}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Type</FieldLabel>
        <NativeSelect
          value={value.semanticType}
          onChange={(event) =>
            setValue({ ...value, semanticType: event.target.value as SemanticType })
          }
        >
          {['currency', 'count', 'ratio', 'text', 'date', 'id'].map((item) => (
            <NativeSelectOption key={item} value={item}>
              {item}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Aggregation</FieldLabel>
        <NativeSelect
          disabled={value.role !== 'metric'}
          value={value.defaultAggregation ?? ''}
          onChange={(event) =>
            setValue({
              ...value,
              defaultAggregation: event.target.value ? (event.target.value as Aggregation) : null,
            })
          }
        >
          <NativeSelectOption value="">None</NativeSelectOption>
          {aggregations.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {item}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel>Description</FieldLabel>
        <Input
          value={value.description ?? ''}
          onChange={(event) => setValue({ ...value, description: event.target.value })}
        />
      </Field>
      <Button variant="outline" size="sm" disabled={savingField} onClick={() => void save()}>
        {savingField ? 'Saving...' : 'Save'}
      </Button>
      {saveError ? <p className="text-sm text-destructive sm:col-span-full">{saveError}</p> : null}
    </div>
  );
}

const fieldRoleStyles: Record<FieldRole, string> = {
  dimension: 'border-l-emerald-500',
  metric: 'border-l-blue-500',
};

function calculatedFieldRow(
  field: DatasourceDescription['calculatedFields'][number],
): DatasourceFieldRow {
  return {
    ...field,
    key: `calculated:${field.id}`,
    origin: 'calculated',
    description: field.description ?? '',
    editable: true,
  };
}

async function defaultDefinition(
  type: BuilderType,
  source?: BuilderDataSource,
): Promise<WidgetDefinition> {
  if (type === 'dateControl') return { type, defaultDateRange: yearToDateRange };
  if (type === 'text')
    return { type, content: { schemaVersion: 'plain-text-v1', document: 'Add text' } };
  if (!source) throw new Error('Register a datasource before adding a data widget.');
  const description = await describeSource(source.id);
  const fields = [...description.fields, ...description.calculatedFields];
  const date = fields.find((field) => field.semanticType === 'date');
  const dimension = fields.find(
    (field) => field.role === 'dimension' && field.semanticType !== 'date',
  );
  const metricField = fields.find((field) => field.role === 'metric');
  if (type === 'control') {
    if (!dimension) throw new Error('This datasource has no dimension for a filter control.');
    return {
      type,
      dataSourceId: source.id,
      fieldId: dimension.id,
      userDefinedName: 'Filter',
      allowMultiple: true,
    };
  }
  if (!date || !metricField)
    throw new Error('The datasource needs a date field and a metric field.');
  const metric = {
    source: {
      kind: 'field' as const,
      fieldId: metricField.id,
      aggregation: metricField.defaultAggregation ?? 'sum',
    },
    dataType:
      metricField.semanticType === 'currency'
        ? ('currency' as const)
        : metricField.semanticType === 'ratio'
          ? ('percent' as const)
          : ('number' as const),
  };
  const base = { title: `New ${type}`, dataSourceId: source.id, dateRangeFieldId: date.id };
  if (type === 'scorecard') return { ...base, type, metric };
  if (type === 'gauge') return { ...base, type, metric };
  if (!dimension) throw new Error('The datasource needs a dimension for this widget.');
  if (type === 'line')
    return { ...base, type, dimension: { fieldId: dimension.id }, metrics: [metric] };
  if (type === 'table')
    return {
      ...base,
      type,
      dimensions: [{ fieldId: dimension.id }],
      metrics: [metric],
      resultLimit: { mode: 'top', amount: 50 },
      showSubtotals: true,
    };
  return { ...base, type, dimension: { fieldId: dimension.id }, metric, limit: 20 };
}

async function changeSource(
  definition: QueryDefinition,
  sourceId: string,
  dashboardId: string,
  latestDefinition: () => WidgetDefinition = () => definition,
) {
  const [currentSource, targetSource] = await Promise.all([
    describeSource(definition.dataSourceId, dashboardId),
    describeSource(sourceId, dashboardId),
  ]);
  const latest = latestDefinition();
  if (!('dataSourceId' in latest) || latest.dataSourceId !== definition.dataSourceId)
    throw new Error('Widget datasource changed while loading.');
  const remapped = remapWidgetDefinition(latest, currentSource, sourceId, targetSource);
  return remapped.type === 'control' ? { ...remapped, defaultValues: undefined } : remapped;
}

function describeSource(sourceId: string, dashboardId?: string) {
  return callApi<SourceDescription>({
    action: 'describeDatasource',
    dataSourceId: sourceId,
    dashboardId,
  });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
