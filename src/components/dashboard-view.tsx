import { callApi as requestApi } from '#/api/client';
import { useDebouncedValue } from '#/lib/use-debounced-value';
import { stableStringify } from '#/domain/hash';
import { activeDashboardPage } from '#/domain/dashboard-pages';
import { dashboardControlWidgets } from '#/domain/schema';

import { useDashboardQueryRefresh } from './dashboard-query-refresh';
import { DASHBOARD_GRID } from '#/domain/layout';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { ChevronRight, ChevronsUpDown, X } from 'lucide-react';
import {
  drillPathSchema,
  type ComboMetric,
  type ControlState,
  type DashboardDocument,
  type DashboardWidget,
  type DateRange,
  type DrillPath,
} from '#/domain/schema';
import { drillLevels } from '#/domain/drill-down';
import type { QueryResultColumn } from '#/domain/query-result';
import { useApiQuery } from '#/api/query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart';
import { Badge } from '#/components/ui/badge';
import { Command, CommandGroup, CommandInput, CommandList } from '#/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Skeleton } from '#/components/ui/skeleton';
import { widgetQueryRequest } from '#/domain/widget-query';
import { cn } from '#/lib/utils';
import { textBoxClasses, textStyleClasses } from '#/domain/text-style';
import { colorsPerCategory, paletteColor } from '#/domain/chart-colors';
import {
  controlDefaultValues,
  toggleControlValue,
  reconcileDashboardControls,
} from '#/domain/control-state';
import {
  colorScaleBounds,
  colorScalePosition,
  pieBreakdownRows,
  pivotBreakdownRows,
  pivotTableRows,
  type ScaleBounds,
  withComparisonSeries,
} from '#/domain/widget-results';
import { DateRangePicker } from '#/components/date-range-picker';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table';

export function DashboardView({
  dashboard,
  pageId,
  shareToken,
  dateRange,
  onDateRangeChange,
}: {
  dashboard: DashboardDocument;
  pageId?: string;
  shareToken?: string;
  dateRange?: DateRange;
  onDateRangeChange?: (range: DateRange) => void;
}) {
  const defaultDateRange = dashboardDateControlRange(dashboard);
  const [controlState, setControlState] = useState<ControlState>(() => ({
    ...initialControlState(dashboard),
    ...(dateRange && defaultDateRange ? { dateRange } : {}),
  }));
  const [controlsOpen, setControlsOpen] = useState(true);
  useEffect(() => {
    setControlState((current) => reconcileDashboardControls(dashboard, current));
  }, [dashboard.pages]);
  useEffect(() => {
    if (!defaultDateRange) return;
    setControlState((current) => ({ ...current, dateRange: dateRange ?? defaultDateRange }));
  }, [dateRange, defaultDateRange]);
  const ordered = [...(activeDashboardPage(dashboard, pageId)?.widgets ?? [])].sort(
    (left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x,
  );
  const controls = ordered.filter((widget) => isControlWidget(widget));
  const cards = ordered.filter((widget) => !isControlWidget(widget));
  const renderWidget = (widget: DashboardWidget) => (
    <div
      key={widget.id}
      className="min-w-0 md:[grid-column:var(--grid-column)] md:[grid-row:var(--grid-row)] [&>[data-slot=card]]:h-full"
      style={
        {
          '--grid-column': `${widget.layout.x + 1} / span ${Math.min(widget.layout.width, 12)}`,
          '--grid-row': `${widget.layout.y + 1} / span ${widget.layout.height}`,
        } as CSSProperties
      }
    >
      <Widget
        widget={widget}
        dashboardId={dashboard.id}
        timezone={dashboard.timezone}
        defaultDateRange={defaultDateRange}
        shareToken={shareToken}
        controlState={controlState}
        setControlState={setControlState}
        onDateRangeChange={onDateRangeChange}
      />
    </div>
  );
  return (
    <div
      className="grid grid-cols-1 gap-4 md:auto-rows-[var(--grid-row-height)] md:grid-cols-12 md:gap-[var(--grid-gap)] md:p-[var(--grid-gap)]"
      style={
        {
          '--grid-row-height': `${DASHBOARD_GRID.rowHeight}px`,
          '--grid-gap': `${DASHBOARD_GRID.margin[0]}px`,
        } as CSSProperties
      }
    >
      {/*
        Below md the controls sit in a sticky bar above the widgets. `md:contents` dissolves both
        wrappers on larger screens so each control keeps its stored grid placement, and each control
        stays mounted exactly once either way.
      */}
      {controls.length ? (
        <div
          className="sticky top-0 z-30 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 md:contents"
          role="region"
          aria-label="Dashboard controls"
        >
          <div className="flex items-center justify-between gap-2 md:hidden">
            <h2 className="text-sm font-medium">Controls</h2>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={controlsOpen}
              aria-controls="dashboard-controls"
              onClick={() => setControlsOpen((open) => !open)}
            >
              {controlsOpen ? 'Hide controls' : 'Show controls'}
            </Button>
          </div>
          <div
            id="dashboard-controls"
            className={
              controlsOpen
                ? 'mt-3 flex max-h-[45vh] flex-col gap-3 overflow-y-auto md:contents'
                : 'hidden md:contents'
            }
          >
            {controls.map(renderWidget)}
          </div>
        </div>
      ) : null}
      {cards.map(renderWidget)}
    </div>
  );
}

function isControlWidget(widget: DashboardWidget) {
  return widget.definition.type === 'control' || widget.definition.type === 'dateControl';
}

function Widget({
  widget,
  dashboardId,
  timezone,
  defaultDateRange,
  shareToken,
  preview,
  controlState,
  setControlState,
  onDateRangeChange,
}: {
  widget: DashboardWidget;
  dashboardId: string;
  timezone: string;
  defaultDateRange?: DateRange;
  shareToken?: string;
  preview?: boolean;
  controlState: ControlState;
  setControlState: (state: ControlState) => void;
  onDateRangeChange?: (range: DateRange) => void;
}) {
  if (widget.definition.type === 'text')
    return (
      <Card>
        {/* The card is stretched to its grid row, so the content takes the leftover height and the
            stored vertical alignment decides where the text sits in it. */}
        <CardContent
          className={cn(
            'flex flex-1 flex-col pt-(--card-spacing)',
            textBoxClasses(widget.definition.textStyle),
          )}
        >
          <p className={cn('whitespace-pre-wrap', textStyleClasses(widget.definition.textStyle))}>
            {richText(widget.definition.content.document)}
          </p>
        </CardContent>
      </Card>
    );
  if (widget.definition.type === 'dateControl')
    return (
      <DateControl
        timezone={timezone}
        defaultDateRange={defaultDateRange}
        controlState={controlState}
        setControlState={setControlState}
        onDateRangeChange={onDateRangeChange}
      />
    );
  if (widget.definition.type === 'control')
    return (
      <FilterControl
        widgetId={widget.id}
        definitionHash={widget.definitionHash}
        definition={widget.definition}
        dashboardId={dashboardId}
        shareToken={shareToken}
        controlState={controlState}
        setControlState={setControlState}
      />
    );
  return (
    <QueryCard
      widget={widget}
      dashboardId={dashboardId}
      shareToken={shareToken}
      preview={preview}
      controlState={controlState}
    />
  );
}

export function DashboardWidgetView({
  dashboard,
  widget,
  preview = false,
  controlState,
  setControlState,
}: {
  dashboard: DashboardDocument;
  widget: DashboardWidget;
  preview?: boolean;
  controlState: ControlState;
  setControlState: (state: ControlState) => void;
}) {
  return (
    <Widget
      widget={widget}
      dashboardId={dashboard.id}
      timezone={dashboard.timezone}
      defaultDateRange={dashboardDateControlRange(dashboard)}
      preview={preview}
      controlState={controlState}
      setControlState={setControlState}
    />
  );
}

function DateControl({
  timezone,
  defaultDateRange,
  controlState,
  setControlState,
  onDateRangeChange,
}: {
  timezone: string;
  defaultDateRange?: DateRange;
  controlState: ControlState;
  setControlState: (state: ControlState) => void;
  onDateRangeChange?: (range: DateRange) => void;
}) {
  const range = controlState.dateRange;
  if (!range) return null;
  return (
    <Card size="sm" className="h-full px-3 py-3 ring-inset">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 md:flex-row md:items-center md:gap-3">
        <CardTitle className="shrink-0">Date range</CardTitle>
        <div className="min-w-0 flex-1 md:max-w-80">
          <DateRangePicker
            range={range}
            timezone={timezone}
            defaultRange={defaultDateRange}
            onChange={(next) => {
              setControlState({ ...controlState, dateRange: next });
              onDateRangeChange?.(next);
            }}
          />
        </div>
      </div>
    </Card>
  );
}

function FilterControl({
  widgetId,
  definitionHash,
  definition,
  dashboardId,
  shareToken,
  controlState,
  setControlState,
}: {
  widgetId: string;
  definitionHash: string;
  definition: Extract<DashboardWidget['definition'], { type: 'control' }>;
  dashboardId: string;
  shareToken?: string;
  controlState: ControlState;
  setControlState: (state: ControlState) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search);
  const optionsQuery = useApiQuery<{ values: unknown[] }>(
    {
      action: 'getControlOptions',
      dashboardId,
      controlId: widgetId,
      shareToken,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    },
    { revision: definitionHash },
  );
  const values = optionsQuery.data?.values ?? [];
  const status = optionsQuery.isError
    ? 'error'
    : optionsQuery.isPending || search !== debouncedSearch
      ? 'loading'
      : 'ready';
  const selected = (controlState.values?.[widgetId] ?? []).map(String);
  const updateSelected = (next: string[]) =>
    setControlState({
      ...controlState,
      values: { ...controlState.values, [widgetId]: next },
    });
  const select = (value: string) => {
    if (!definition.allowMultiple) {
      updateSelected(toggleControlValue(selected, value, false));
      setOpen(false);
      return;
    }
    updateSelected(toggleControlValue(selected, value, true));
  };
  return (
    <Card size="sm" className="h-full px-3 py-3 ring-inset">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 md:flex-row md:items-center md:gap-3">
        <CardTitle className="shrink-0">{definition.userDefinedName ?? 'Filter'}</CardTitle>
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:max-w-80">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="w-full justify-between font-normal"
                  aria-label={`Choose ${definition.userDefinedName ?? 'filter'} values`}
                />
              }
            >
              {selected.length
                ? definition.allowMultiple
                  ? `${selected.length} selected`
                  : selected[0]
                : 'All values'}
              <ChevronsUpDown className="size-4 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-(--anchor-width) p-0" align="start">
              <Command shouldFilter={false} label={definition.userDefinedName ?? 'Filter values'}>
                <CommandInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search values…"
                />
                <CommandList aria-multiselectable={definition.allowMultiple || undefined}>
                  {status === 'loading' ? (
                    <div role="status" className="py-6 text-center text-sm text-muted-foreground">
                      Loading…
                    </div>
                  ) : status === 'error' ? (
                    <div role="alert" className="flex flex-col items-center gap-2 py-6 text-sm">
                      <p>Could not load values.</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void optionsQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : values.length ? (
                    <CommandGroup>
                      {values.map((value) => {
                        const option = String(value);
                        const checked = selected.includes(option);
                        return (
                          <button
                            type="button"
                            role="option"
                            key={option}
                            aria-selected={checked}
                            className="flex min-h-10 w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                            onKeyDown={handleFilterOptionKeyDown}
                            onClick={() => select(option)}
                          >
                            {option}
                            <span aria-hidden="true" className="ml-auto">
                              {checked ? '✓' : ''}
                            </span>
                          </button>
                        );
                      })}
                    </CommandGroup>
                  ) : (
                    <div className="py-6 text-center text-sm">No values found.</div>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selected.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((value) => (
                <Badge key={value} variant="secondary" className="gap-1 pr-1">
                  {value}
                  <button
                    type="button"
                    className="flex size-6 items-center justify-center rounded-sm hover:bg-muted"
                    aria-label={`Remove ${value}`}
                    onClick={() => updateSelected(selected.filter((item) => item !== value))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <Button variant="ghost" size="xs" onClick={() => updateSelected([])}>
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function handleFilterOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.stopPropagation();
  if (event.key === 'Enter' || event.key === ' ') return;
  event.preventDefault();
  const options = [
    ...(event.currentTarget
      .closest('[role="listbox"]')
      ?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
  ];
  const index = options.indexOf(event.currentTarget);
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  options[(index + direction + options.length) % options.length]?.focus();
}

interface WidgetQueryResult {
  rows: Record<string, unknown>[];
  columns: QueryResultColumn[];
  comparisonRows?: Record<string, unknown>[];
  summaryRow?: Record<string, unknown>;
  scaleBounds?: Record<string, ScaleBounds>;
  hasMore?: boolean;
}

function QueryCard({
  widget,
  dashboardId,
  shareToken,
  preview,
  controlState,
}: {
  widget: DashboardWidget;
  dashboardId: string;
  shareToken?: string;
  preview?: boolean;
  controlState: ControlState;
}) {
  const definition = widget.definition;
  // Compare query inputs by content, since saves and refreshes replace their objects.
  const definitionKey = stableStringify(definition);
  // Empty selections are left out so a control that only gains an empty entry does not re-run
  // the query. Controls with defaults always carry values, so no default is hidden by this.
  const controlsKey = stableStringify({
    dateRange: controlState.dateRange,
    values: Object.fromEntries(
      Object.entries(controlState.values ?? {}).filter(([, values]) => values.length > 0),
    ),
  });
  const { revision, inputsRevision, changePending } = useDashboardQueryRefresh();
  const refreshed = useRef(revision);
  const [page, setPage] = useState(0);
  // Clicked values per drilled level. Kept across control changes, dropped when the widget changes.
  const [drillPath, setDrillPath] = useState<DrillStep[]>([]);
  useEffect(() => setPage(0), [controlsKey, dashboardId, definitionKey, widget.id]);
  // Keeps the same array when nothing is drilled, so mounting does not trigger a second query.
  useEffect(
    () => setDrillPath((path) => (path.length ? [] : path)),
    [dashboardId, definitionKey, widget.id],
  );
  const request = widgetQueryRequest({
    dashboardId,
    widget,
    controlState,
    drillPath: drillPath.length ? drillPath.map((step) => step.value) : undefined,
    preview: preview ?? false,
    shareToken,
    page,
    refresh: false,
  });
  const resultQuery = useApiQuery<WidgetQueryResult>(request, {
    revision: [
      revision,
      inputsRevision,
      definitionKey,
      controlsKey,
      widget.definitionHash,
      widget.layout.width,
    ],
    queryFn: async (signal) => {
      const result = await requestApi<WidgetQueryResult>(
        widgetQueryRequest({
          dashboardId,
          widget,
          controlState,
          drillPath: drillPath.length ? drillPath.map((step) => step.value) : undefined,
          preview: preview ?? false,
          shareToken,
          page,
          refresh: revision !== refreshed.current,
        }),
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
        },
      );
      refreshed.current = revision;
      return result;
    },
  });
  // Keep the previous page or refresh usable on failure, but never reuse rows for
  // a different filter, definition, or drill level.
  const resultContext = stableStringify([
    dashboardId,
    shareToken,
    definitionKey,
    controlsKey,
    drillPath,
    preview,
  ]);
  const previousResult = useRef<{ context: string; data: WidgetQueryResult }>(undefined);
  if (resultQuery.data) previousResult.current = { context: resultContext, data: resultQuery.data };
  const displayed =
    resultQuery.data ??
    (previousResult.current?.context === resultContext ? previousResult.current.data : undefined);
  const {
    rows,
    columns,
    comparisonRows,
    summaryRow,
    scaleBounds,
    hasMore = false,
  } = displayed ?? {};
  const error = resultQuery.error?.message;
  useEffect(() => {
    if (!resultQuery.isFetching) return;
    changePending(1);
    return () => changePending(-1);
  }, [resultQuery.isFetching, changePending]);
  if (!('title' in definition)) return null;
  const canDrill = drillPath.length < drillLevels(definition).length - 1;
  // Dropping the old level's rows shows a skeleton and keeps a second click from drilling into a
  // value of the level that is being left.
  const changeDrillPath = (next: DrillStep[]) => {
    setDrillPath(next);
  };
  return (
    <Card className="h-full min-h-0">
      <CardHeader className="shrink-0">
        <CardTitle className={textStyleClasses(definition.titleStyle)}>
          {definition.title}
        </CardTitle>
        {drillPath.length ? <DrillBreadcrumb path={drillPath} onChange={changeDrillPath} /> : null}
        {error ? <CardDescription>{error}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-auto">
        {!rows || !columns ? (
          error ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void resultQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <Skeleton className="h-28 w-full" />
          )
        ) : (
          <div className="min-h-0 flex-1">
            <Result
              definition={definition}
              rows={rows}
              columns={columns}
              comparisonRows={comparisonRows}
              summaryRow={summaryRow}
              scaleBounds={scaleBounds}
              page={page}
              hasMore={hasMore}
              setPage={setPage}
              onDrill={canDrill ? (step) => changeDrillPath([...drillPath, step]) : undefined}
            />
            {error ? (
              <Button variant="outline" size="sm" onClick={() => void resultQuery.refetch()}>
                Retry
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface DrillStep {
  value: DrillPath[number];
  label: string;
}

function DrillBreadcrumb({
  path,
  onChange,
}: {
  path: DrillStep[];
  onChange: (path: DrillStep[]) => void;
}) {
  return (
    <nav aria-label="Drill-down" className="-ml-2 flex flex-wrap items-center text-xs">
      <Button variant="ghost" size="xs" onClick={() => onChange([])}>
        All
      </Button>
      {path.map((step, index) => (
        <Fragment key={index}>
          <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
          {index === path.length - 1 ? (
            <span aria-current="location" className="px-2 font-medium">
              {step.label}
            </span>
          ) : (
            <Button variant="ghost" size="xs" onClick={() => onChange(path.slice(0, index + 1))}>
              {step.label}
            </Button>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

export function Result({
  definition,
  rows,
  columns,
  comparisonRows,
  summaryRow,
  scaleBounds,
  page,
  hasMore,
  setPage,
  onDrill,
}: {
  definition: Extract<DashboardWidget['definition'], { title: string }>;
  rows: Record<string, unknown>[];
  columns: QueryResultColumn[];
  comparisonRows?: Record<string, unknown>[];
  summaryRow?: Record<string, unknown>;
  // Whole-result bounds for paged tables. Without them the scale spans the rows shown.
  scaleBounds?: Record<string, ScaleBounds>;
  page: number;
  hasMore: boolean;
  setPage: (page: number) => void;
  /** Set while the chart has a deeper drill level; called with the clicked dimension value. */
  onDrill?: (step: DrillStep) => void;
}) {
  const dimensionColumns = columns.filter((column) => column.kind === 'dimension');
  const metricColumns = columns.filter((column) => column.kind === 'metric');
  if (definition.type === 'scorecard' || definition.type === 'gauge') {
    const metric = metricColumns[0]!;
    const value = rows[0]?.[metric.key];
    const previous = comparisonRows?.[0]?.[metric.key];
    const maximum =
      definition.type === 'gauge'
        ? definition.upperLimit?.kind === 'manual'
          ? definition.upperLimit.value
          : rows[0]?.upper_limit
        : undefined;
    const parsedMaximum = maximum == null ? undefined : Number(maximum);
    const numericMaximum =
      parsedMaximum !== undefined && Number.isFinite(parsedMaximum) && parsedMaximum > 0
        ? parsedMaximum
        : undefined;
    return (
      <div className="@container space-y-2">
        {/* Fluid size: scales with tile width so long values don't get clipped on small screens */}
        <p className="text-[clamp(1.25rem,13cqi,2.25rem)] font-semibold tracking-tight">
          {formatValue(value, metric)}
        </p>
        {previous !== undefined ? (
          <p className="text-sm text-muted-foreground">Previous: {formatValue(previous, metric)}</p>
        ) : null}
        {numericMaximum !== undefined ? (
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            aria-label={`${String(value)} of ${numericMaximum}`}
          >
            <div
              className="h-full bg-primary"
              style={{
                width: `${Math.min(100, Math.max(0, (Number(value) / numericMaximum) * 100))}%`,
              }}
            />
          </div>
        ) : null}
      </div>
    );
  }
  if (definition.type === 'table') {
    const rowColumns = dimensionColumns.slice(0, definition.dimensions.length);
    const pivotColumn = definition.pivotDimension
      ? dimensionColumns[definition.dimensions.length]
      : undefined;
    const pivotSeries = pivotColumn
      ? pivotTableRows(
          [...rows, ...(comparisonRows ?? [])],
          rowColumns.map((column) => column.key),
          pivotColumn.key,
          metricColumns.map((column) => column.key),
        ).series
      : undefined;
    const tableRows = pivotColumn
      ? pivotTableRows(
          rows,
          rowColumns.map((column) => column.key),
          pivotColumn.key,
          metricColumns.map((column) => column.key),
          pivotSeries,
        ).rows
      : rows;
    const tableComparisonRows = pivotColumn
      ? pivotTableRows(
          comparisonRows ?? [],
          rowColumns.map((column) => column.key),
          pivotColumn.key,
          metricColumns.map((column) => column.key),
          pivotSeries,
        ).rows
      : comparisonRows;
    const metricBounds =
      scaleBounds ??
      colorScaleBounds(
        rows,
        metricColumns.map((column) => column.key),
      );
    const tableMetricColumns = pivotSeries
      ? pivotSeries.flatMap((series) =>
          metricColumns.map((column) => ({
            ...column,
            key: `${series.key}_${column.key}`,
            bounds: metricBounds[column.key],
          })),
        )
      : metricColumns.map((column) => ({ ...column, bounds: metricBounds[column.key] }));
    const tableColumns: Array<QueryResultColumn & { bounds?: ScaleBounds }> = [
      ...rowColumns,
      ...tableMetricColumns,
    ];
    const summary = definition.showSummaryRow ? summaryRow : undefined;
    return (
      <div className="space-y-3">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {rowColumns.map((column) => (
                <TableHead
                  key={column.key}
                  rowSpan={pivotSeries ? 2 : undefined}
                  className="h-8 py-1"
                >
                  {column.label}
                </TableHead>
              ))}
              {pivotSeries
                ? pivotSeries.map((series) => (
                    <TableHead
                      key={series.key}
                      colSpan={metricColumns.length}
                      className="h-8 border-l py-1 text-center"
                    >
                      {series.label}
                    </TableHead>
                  ))
                : metricColumns.map((column) => (
                    <TableHead key={column.key} className="h-8 py-1 text-right">
                      {column.label}
                    </TableHead>
                  ))}
            </TableRow>
            {pivotSeries ? (
              <TableRow>
                {pivotSeries.flatMap((series) =>
                  metricColumns.map((column) => (
                    <TableHead
                      key={`${series.key}_${column.key}`}
                      className="h-7 border-l py-1 text-right"
                    >
                      {column.label}
                    </TableHead>
                  )),
                )}
              </TableRow>
            ) : null}
          </TableHeader>
          <TableBody>
            {tableRows.map((row, index) => {
              const grouping = Number(row.__grouping ?? 0);
              const grandTotal = grouping > 0 && row.dimension_1 == null;
              const subtotal = grouping > 0 && !grandTotal;
              const startsGroup =
                index > 0 && !grandTotal && row.dimension_1 !== tableRows[index - 1]?.dimension_1;
              return (
                <TableRow
                  key={index}
                  className={cn(
                    startsGroup && 'border-t-2 border-t-foreground/20',
                    // Totals carry the numbers people actually read off the table, so they get a
                    // rule above them and a heavier weight rather than a faint tint alone.
                    subtotal && 'border-t border-t-foreground/20 bg-muted font-semibold',
                    grandTotal && 'border-t-2 border-t-foreground/40 bg-muted font-semibold',
                  )}
                >
                  {tableColumns.map((column, columnIndex) => {
                    let value = formatValue(row[column.key], column);
                    if (grandTotal && columnIndex === 0) value = 'Grand total';
                    else if (subtotal && columnIndex === definition.dimensions.length - 1)
                      value = 'Total';
                    else if ((subtotal || grandTotal) && row[column.key] == null) value = '';
                    const scale = column.colorScale;
                    const position =
                      scale && !subtotal && !grandTotal
                        ? colorScalePosition(row[column.key], column.bounds, scale.invert)
                        : undefined;
                    return (
                      <TableCell
                        key={column.key}
                        className={cn(
                          'h-7 px-2 py-1',
                          column.kind === 'metric' && 'text-right tabular-nums',
                          conditionalFormatClass(row[column.key], column),
                        )}
                        style={
                          scale?.style === 'heatmap' && position !== undefined
                            ? { backgroundColor: colorScaleTint(scale.color, position * 45) }
                            : undefined
                        }
                      >
                        {scale?.style === 'bar' && position !== undefined ? (
                          <div className="flex items-center gap-2">
                            <span aria-hidden className="h-3 min-w-8 flex-1">
                              <span
                                data-slot="color-scale-bar"
                                className="block h-full rounded-sm"
                                style={{
                                  width: `${position * 100}%`,
                                  backgroundColor: colorScaleTint(scale.color, 60),
                                }}
                              />
                            </span>
                            {value}
                          </div>
                        ) : (
                          value
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {summary && !pivotSeries ? (
              <TableRow className="border-t-2 border-t-foreground/40 bg-muted font-semibold">
                {columns.map((column, columnIndex) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      'h-7 px-2 py-1',
                      column.kind === 'metric' && 'text-right tabular-nums',
                    )}
                  >
                    {columnIndex === 0 && definition.dimensions.length > 0
                      ? 'Summary'
                      : columnIndex < definition.dimensions.length
                        ? ''
                        : formatValue(summary[column.key], column)}
                  </TableCell>
                ))}
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {tableComparisonRows?.length ? (
          <div>
            <p className="mb-2 text-sm font-medium">
              {definition.comparison?.mode === 'previousYear' ? 'Previous year' : 'Previous period'}
            </p>
            <Table>
              <TableBody>
                {tableComparisonRows.map((row, index) => (
                  <TableRow key={index}>
                    {tableColumns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(column.kind === 'metric' && 'text-right tabular-nums')}
                      >
                        {formatValue(row[column.key], column)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {definition.resultLimit.mode === 'pagination' ? (
          <div className="flex items-center justify-between text-sm">
            <span>
              {rows.length ? page * definition.resultLimit.amount + 1 : 0}–
              {rows.length ? page * definition.resultLimit.amount + rows.length : 0}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!hasMore}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  if (
    (!rows.length && !comparisonRows?.length) ||
    !dimensionColumns.length ||
    !metricColumns.length
  )
    return <p className="text-sm text-muted-foreground">No rows for this date range.</p>;
  let dimension = dimensionColumns[0]!;
  const drillColumn = dimension;
  let currentRows = normalizeMetricValues(rows, metricColumns);
  let previousRows = normalizeMetricValues(comparisonRows ?? [], metricColumns);
  let chartMetrics = metricColumns;
  if (definition.type === 'bar' && definition.breakdownDimension && dimensionColumns[1]) {
    const breakdownSeries = pivotBreakdownRows([...currentRows, ...previousRows]).series;
    currentRows = pivotBreakdownRows(currentRows, breakdownSeries).rows;
    previousRows = pivotBreakdownRows(previousRows, breakdownSeries).rows;
    chartMetrics = breakdownSeries.map((series) => ({
      ...metricColumns[0]!,
      key: series.key,
      label: series.label,
    }));
  }
  if (definition.type === 'pie' && definition.breakdownDimension && dimensionColumns[1]) {
    currentRows = pieBreakdownRows(currentRows);
    dimension = { ...dimension, key: 'label' };
  }
  const comparison =
    definition.type !== 'pie' && previousRows.length
      ? withComparisonSeries(
          currentRows,
          previousRows,
          'key',
          chartMetrics.map((metric) => metric.key),
        )
      : undefined;
  let chartRows = comparison?.rows ?? currentRows;
  const comboMetrics = definition.type === 'combo' ? definition.metrics : undefined;
  // With both combo axes in use, the legend and tooltip say which scale a series is read against.
  const axisSuffix = (index: number) => {
    const axis = comboMetrics?.[index]?.axis;
    return axis && new Set(comboMetrics.map((metric) => metric.axis)).size > 1
      ? ` (${axis} axis)`
      : '';
  };
  const sourceSeries = [
    ...chartMetrics.map((column, index) => ({
      sourceKey: column.key,
      column,
      colorIndex: index,
      yAxisId: comboMetrics?.[index]?.axis ?? lineMetricAxis(index),
      mark: comboMetrics?.[index]?.mark ?? 'line',
      isComparison: false,
      label: `${column.label}${axisSuffix(index)}`,
    })),
    ...(comparison?.series.map((sourceKey, index) => {
      const column = chartMetrics[index]!;
      return {
        sourceKey,
        column,
        colorIndex: index,
        yAxisId: comboMetrics?.[index]?.axis ?? lineMetricAxis(index),
        mark: comboMetrics?.[index]?.mark ?? 'line',
        isComparison: true,
        label: `Previous ${column.label}${axisSuffix(index)}`,
      };
    }) ?? []),
  ];
  const occupiedKeys = new Set(chartRows.flatMap((row) => Object.keys(row)));
  const series = sourceSeries.map((item, index) => {
    let key = `chart_series_${index}`;
    while (occupiedKeys.has(key)) key = `_${key}`;
    occupiedKeys.add(key);
    return { ...item, key };
  });
  chartRows = chartRows.map((row) => ({
    ...row,
    ...Object.fromEntries(series.map((item) => [item.key, row[item.sourceKey]])),
  }));
  let pieLegendKey = dimension.key;
  let pieConfig = {};
  if (definition.type === 'pie') {
    pieLegendKey = 'chart_slice';
    while (occupiedKeys.has(pieLegendKey)) pieLegendKey = `_${pieLegendKey}`;
    chartRows = chartRows.map((row, index) => {
      const key = `chart_slice_${index}`;
      return {
        ...row,
        [pieLegendKey]: key,
        fill: `var(--color-${key})`,
      };
    });
    pieConfig = Object.fromEntries(
      chartRows.map((row, index) => [
        `chart_slice_${index}`,
        {
          label: formatAxisValue(row[dimension.key], dimension),
          color: paletteColor(index),
        },
      ]),
    );
  }
  // Recharts colours a bar chart per series, so a single-series chart draws every bar the same.
  // 'category' hands each row its own palette slot instead, through the config so the colours stay
  // theme-aware like every other series colour.
  const barCellColors =
    definition.type === 'bar' && colorsPerCategory(definition.colorBy, series.length)
      ? chartRows.map((_, index) => `chart_bar_${index}`)
      : undefined;
  let barConfig = {};
  if (barCellColors) {
    // The row carries the colour too so the tooltip swatch matches the bar it points at.
    chartRows = chartRows.map((row, index) => ({
      ...row,
      fill: `var(--color-${barCellColors[index]})`,
    }));
    barConfig = Object.fromEntries(
      barCellColors.map((key, index) => [key, { color: paletteColor(index) }]),
    );
  }
  const config = {
    ...Object.fromEntries(
      series.map((item) => [item.key, { label: item.label, color: paletteColor(item.colorIndex) }]),
    ),
    ...pieConfig,
    ...barConfig,
  };
  // Takes the clicked row itself: Recharts indexes bars and slices after dropping empty ones, so
  // their click index does not point into chartRows. Empty (null) dimension values cannot be
  // drilled into, because an equality filter never matches them.
  const drill = onDrill
    ? (row: Record<string, unknown> | undefined) => {
        const value = drillPathSchema.element.safeParse(row?.[drillColumn.key]);
        if (value.success)
          onDrill({ value: value.data, label: formatDimensionLabel(value.data, drillColumn) });
      }
    : undefined;
  const drillClass = drill ? 'cursor-pointer' : undefined;
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          // Recharts hands over the raw dimension value as the label, which for dates is the stored
          // timestamp. Read it back off the row so it can be rendered in the visitor's locale.
          labelFormatter={(_, items) => {
            const row = items?.[0]?.payload as Record<string, unknown> | undefined;
            return formatDimensionLabel(row?.[dimension.key], dimension);
          }}
          valueFormatter={(value, name) =>
            formatValue(
              value,
              series.find((item) => item.key === String(name))?.column ?? metricColumns[0]!,
            )
          }
        />
      }
    />
  );
  if (definition.type === 'pie')
    return (
      <ChartContainer
        role="img"
        aria-label={`${definition.title} chart`}
        className={cn(
          'mx-auto aspect-square max-h-72 md:h-full md:max-h-full md:min-h-0',
          drillClass,
        )}
        config={config}
      >
        <PieChart>
          {tooltip}
          <Pie
            onClick={drill ? (item) => drill(item.payload) : undefined}
            data={chartRows}
            dataKey={series[0]?.key ?? ''}
            nameKey={pieLegendKey}
            fill={`var(--color-${series[0]?.key ?? ''})`}
            isAnimationActive={false}
          />
          <ChartLegend content={<ChartLegendContent nameKey={pieLegendKey} />} />
        </PieChart>
      </ChartContainer>
    );
  if (definition.type === 'bar')
    return (
      <ChartContainer
        role="img"
        aria-label={`${definition.title} chart`}
        className={cn('h-72 w-full md:h-full md:min-h-0', drillClass)}
        config={config}
      >
        <BarChart data={chartRows}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={dimension.key}
            tickFormatter={(value) => formatAxisValue(value, dimension)}
          />
          <YAxis tickFormatter={(value) => formatAxisValue(value, metricColumns[0]!)} />
          {tooltip}
          {series.map((item) => (
            <Bar
              key={item.key}
              onClick={drill ? (item) => drill(item.payload) : undefined}
              dataKey={item.key}
              fill={`var(--color-${item.key})`}
              fillOpacity={item.isComparison ? 0.5 : 1}
              radius={6}
              isAnimationActive={false}
            >
              {barCellColors?.map((key) => (
                <Cell key={key} fill={`var(--color-${key})`} />
              ))}
            </Bar>
          ))}
          {/* A legend naming the single metric would contradict bars that each carry their own
              colour, and the x-axis already labels them. */}
          {barCellColors ? null : <ChartLegend content={<ChartLegendContent />} />}
        </BarChart>
      </ChartContainer>
    );
  if (comboMetrics) {
    const axes = comboChartAxes(comboMetrics, chartMetrics);
    // Bars render first so lines stay visible on top of them.
    const ordered = [
      ...series.filter((item) => item.mark === 'bar'),
      ...series.filter((item) => item.mark === 'line'),
    ];
    return (
      <ChartContainer
        role="img"
        aria-label={`${definition.title} chart`}
        className="h-72 w-full md:h-full md:min-h-0"
        config={config}
      >
        <ComposedChart data={chartRows}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={dimension.key}
            tickFormatter={(value) => formatAxisValue(value, dimension)}
          />
          {axes.map(({ axis, column, label }) => (
            <YAxis
              key={axis}
              yAxisId={axis}
              orientation={axis}
              width={axes.length > 1 ? 76 : undefined}
              tickFormatter={(value) => formatAxisValue(value, column)}
            >
              {axes.length > 1 ? (
                <Label
                  value={label}
                  angle={axis === 'left' ? -90 : 90}
                  position={axis === 'left' ? 'insideLeft' : 'insideRight'}
                  className="fill-muted-foreground text-[11px]"
                  style={{ textAnchor: 'middle' }}
                />
              ) : null}
            </YAxis>
          ))}
          {tooltip}
          {ordered.map((item) =>
            item.mark === 'bar' ? (
              <Bar
                key={item.key}
                dataKey={item.key}
                yAxisId={item.yAxisId}
                fill={`var(--color-${item.key})`}
                fillOpacity={item.isComparison ? 0.5 : 1}
                radius={6}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={item.key}
                dataKey={item.key}
                yAxisId={item.yAxisId}
                stroke={`var(--color-${item.key})`}
                strokeWidth={2}
                strokeDasharray={item.isComparison ? '4 4' : undefined}
                dot={false}
                isAnimationActive={false}
              />
            ),
          )}
          <ChartLegend content={<ChartLegendContent />} />
        </ComposedChart>
      </ChartContainer>
    );
  }
  const axes = lineChartAxes(chartMetrics);
  return (
    <ChartContainer
      role="img"
      aria-label={`${definition.title} chart`}
      className={cn('h-72 w-full md:h-full md:min-h-0', drillClass)}
      config={config}
    >
      <LineChart
        data={chartRows}
        // No active index means the click was outside the plot, for example on the legend.
        onClick={
          drill
            ? (state) =>
                state.activeIndex == null ? undefined : drill(chartRows[Number(state.activeIndex)])
            : undefined
        }
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={dimension.key}
          tickFormatter={(value) => formatAxisValue(value, dimension)}
        />
        {axes.map(({ metric, yAxisId, orientation }) => (
          <YAxis
            key={metric.key}
            yAxisId={yAxisId}
            orientation={orientation}
            width={axes.length > 1 ? 76 : undefined}
            tickFormatter={(value) => formatAxisValue(value, metric)}
          >
            {/* Two scales are unreadable without saying which metric each one belongs to. A single
                axis needs no caption because the legend already names the metric. */}
            {axes.length > 1 ? (
              <Label
                value={metric.label}
                angle={orientation === 'left' ? -90 : 90}
                position={orientation === 'left' ? 'insideLeft' : 'insideRight'}
                className="fill-muted-foreground text-[11px]"
                style={{ textAnchor: 'middle' }}
              />
            ) : null}
          </YAxis>
        ))}
        {tooltip}
        {series.map((item) => (
          <Line
            key={item.key}
            dataKey={item.key}
            yAxisId={item.yAxisId}
            stroke={`var(--color-${item.key})`}
            strokeDasharray={item.isComparison ? '4 4' : undefined}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  );
}

function conditionalFormatClass(value: unknown, column: QueryResultColumn) {
  if (column.kind !== 'metric') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const rule = column.conditionalFormat?.find((candidate) => {
    if (candidate.comparator === 'between')
      return number >= candidate.min && number <= candidate.max;
    if (candidate.comparator === 'gt') return number > candidate.value;
    if (candidate.comparator === 'gte') return number >= candidate.value;
    if (candidate.comparator === 'lt') return number < candidate.value;
    return number <= candidate.value;
  });
  if (!rule) return undefined;
  return {
    positive: 'bg-emerald-500/20',
    warning: 'bg-amber-500/25',
    negative: 'bg-red-500/20',
    neutral: 'bg-muted',
  }[rule.color];
}

// Same hues as threshold rules. Heatmaps stop at 45% so cell text keeps its contrast in both themes.
function colorScaleTint(
  color: NonNullable<QueryResultColumn['colorScale']>['color'],
  percent: number,
) {
  const hue = {
    positive: 'var(--color-emerald-500)',
    warning: 'var(--color-amber-500)',
    negative: 'var(--color-red-500)',
    neutral: 'var(--muted-foreground)',
  }[color];
  return `color-mix(in oklab, ${hue} ${Math.round(percent)}%, transparent)`;
}

export function lineMetricAxis(index: number) {
  return `metric_${Math.min(index, 1)}`;
}

export function lineChartAxes(metrics: QueryResultColumn[]) {
  return metrics.slice(0, 2).map((metric, index) => ({
    metric,
    yAxisId: lineMetricAxis(index),
    orientation: index === 0 ? ('left' as const) : ('right' as const),
  }));
}

// One y-axis per side that carries a combo metric. Validation keeps one data type per axis, so the
// first metric on a side formats its ticks and the caption names every metric drawn against it.
export function comboChartAxes(metrics: ComboMetric[], columns: QueryResultColumn[]) {
  return (['left', 'right'] as const).flatMap((axis) => {
    const onAxis = columns.filter((_, index) => metrics[index]?.axis === axis);
    return onAxis.length
      ? [{ axis, column: onAxis[0]!, label: onAxis.map((column) => column.label).join(', ') }]
      : [];
  });
}

export function initialControlState(dashboard: DashboardDocument): ControlState {
  const dateControl = dashboardControlWidgets(dashboard).find(
    (widget) => widget.definition.type === 'dateControl',
  );
  const values = Object.fromEntries(
    dashboardControlWidgets(dashboard).flatMap((widget) =>
      widget.definition.type === 'control' && controlDefaultValues(widget)?.length
        ? [[widget.id, controlDefaultValues(widget)]]
        : [],
    ),
  );
  return {
    ...(dateControl?.definition.type === 'dateControl'
      ? { dateRange: dateControl.definition.defaultDateRange ?? dashboard.defaultDateRange }
      : {}),
    ...(Object.keys(values).length ? { values } : {}),
  };
}

export function dashboardDateControlRange(dashboard: DashboardDocument) {
  const control = dashboardControlWidgets(dashboard).find(
    (widget) => widget.definition.type === 'dateControl',
  );
  return control?.definition.type === 'dateControl'
    ? (control.definition.defaultDateRange ?? dashboard.defaultDateRange)
    : undefined;
}

function richText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(richText).join('\n');
  if (value && typeof value === 'object')
    return Object.values(value).map(richText).filter(Boolean).join(' ');
  return '';
}
export function formatValue(value: unknown, column: QueryResultColumn) {
  const number = numericMetricValue(value, column);
  if (number === undefined) return value == null ? '' : String(value);
  const radix = column.radix ?? 2;
  if (column.dataType === 'duration') return formatDuration(number, radix);
  if (column.dataType === 'percent')
    return new Intl.NumberFormat(undefined, {
      style: 'percent',
      maximumFractionDigits: radix,
    }).format(number);
  if (column.dataType === 'currency')
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: radix,
      minimumFractionDigits: radix,
    }).format(number);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: radix }).format(number);
}

function numericMetricValue(value: unknown, column: QueryResultColumn) {
  if (column.kind !== 'metric') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const number = Number(value);
  if (/^[+-]?\d+$/u.test(value.trim()) && !Number.isSafeInteger(number)) return undefined;
  return Number.isFinite(number) ? number : undefined;
}

function normalizeMetricValues(rows: Record<string, unknown>[], metrics: QueryResultColumn[]) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        const column = metrics.find((metric) => metric.key === key);
        return [key, column ? (numericMetricValue(value, column) ?? value) : value];
      }),
    ),
  );
}

// Date dimensions arrive as `YYYY-MM-DD` or as a full timestamp. Both are read as local wall clock
// so the rendered day is the bucket the query produced, not that bucket shifted by the viewer's zone.
function dimensionDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? undefined : value;
  if (typeof value !== 'string') return undefined;
  const parts = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/u.exec(value);
  if (!parts) return undefined;
  const date = new Date(`${parts[1]}T${parts[2] ?? '00:00'}`);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

/**
 * Label for tooltips and other places with room for a full value. Dates get the visitor's locale
 * format instead of the stored timestamp; everything else falls back to the compact axis format.
 */
export function formatDimensionLabel(value: unknown, column: QueryResultColumn) {
  if (column.kind === 'dimension' && column.dataType === 'date') {
    const date = dimensionDate(value);
    if (date)
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        // Buckets sit at midnight, so a time is only worth showing when the data carries one.
        ...(date.getHours() || date.getMinutes() ? { timeStyle: 'short' } : {}),
      }).format(date);
  }
  return formatAxisValue(value, column);
}

export function formatAxisValue(value: unknown, column: QueryResultColumn) {
  if (column.kind === 'dimension' && column.dataType === 'date') {
    const date = dimensionDate(value);
    if (date)
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }
  const number = numericMetricValue(value, column);
  if (number === undefined) return String(value);
  if (column.dataType === 'percent')
    return new Intl.NumberFormat(undefined, {
      style: 'percent',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(number);
  if (Math.abs(number) >= 1_000 && Math.abs(number) < 1_000_000)
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(number / 1_000)}k`;
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(number);
}

function formatDuration(seconds: number, radix: number) {
  const sign = seconds < 0 ? '-' : '';
  const absolute = Math.abs(seconds);
  if (absolute < 60)
    return `${sign}${new Intl.NumberFormat(undefined, { maximumFractionDigits: radix }).format(absolute)}s`;
  const rounded = Math.round(absolute);
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainingSeconds = rounded % 60;
  return `${sign}${[
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    remainingSeconds ? `${remainingSeconds}s` : '',
  ]
    .filter(Boolean)
    .join(' ')}`;
}
