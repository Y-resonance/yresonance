import type { WidgetDefinition } from './schema';
import type { ResolvedDateGranularity } from './date-granularity';

interface BreakdownSeries {
  key: string;
  label: string;
  value: string;
}

export function pivotBreakdownRows(
  rows: Record<string, unknown>[],
  providedSeries?: BreakdownSeries[],
) {
  const [dimension, breakdown, metric] = Object.keys(rows[0] ?? {});
  if (!dimension || !breakdown || !metric)
    return {
      rows,
      series:
        providedSeries ?? (metric ? [{ key: metric, label: metric, value: valueKey(metric) }] : []),
    };
  const breakdownValues = new Map<string, unknown>();
  for (const row of rows) breakdownValues.set(valueKey(row[breakdown]), row[breakdown]);
  const series =
    providedSeries ??
    [...breakdownValues.entries()].map(([value, label], index) => ({
      key: `breakdown_${index}`,
      label: String(label),
      value,
    }));
  const seriesByValue = new Map(series.map((item) => [item.value, item]));
  const pivoted = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = valueKey(row[dimension]);
    const target = pivoted.get(key) ?? { [dimension]: row[dimension] };
    const breakdownSeries = seriesByValue.get(valueKey(row[breakdown]));
    if (breakdownSeries) target[breakdownSeries.key] = row[metric];
    pivoted.set(key, target);
  }
  return { rows: [...pivoted.values()], series };
}

export function pieBreakdownRows(rows: Record<string, unknown>[]) {
  const [dimension, breakdown, metric] = Object.keys(rows[0] ?? {});
  if (!dimension || !breakdown || !metric) return rows;
  // The raw dimension value stays on the row so a slice can still be drilled into.
  return rows.map((row) => ({
    label: `${String(row[dimension])} · ${String(row[breakdown])}`,
    [dimension]: row[dimension],
    [metric]: row[metric],
  }));
}

interface PivotTableSeries {
  key: string;
  label: string;
  value: string;
}

export function pivotTableRows(
  rows: Record<string, unknown>[],
  rowDimensionKeys: string[],
  pivotKey: string,
  metricKeys: string[],
  providedSeries?: PivotTableSeries[],
) {
  const pivotValues = new Map<string, unknown>();
  for (const row of rows) pivotValues.set(valueKey(row[pivotKey]), row[pivotKey]);
  const series =
    providedSeries ??
    [...pivotValues.entries()].map(([value, label], index) => ({
      key: `pivot_${index}`,
      label: String(label ?? 'None'),
      value,
    }));
  const seriesByValue = new Map(series.map((item) => [item.value, item]));
  const pivoted = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const grouping = row.__grouping ?? 0;
    const rowKey = JSON.stringify([
      ...rowDimensionKeys.map((key) => valueKey(row[key])),
      valueKey(grouping),
    ]);
    const target = pivoted.get(rowKey) ?? {
      ...Object.fromEntries(rowDimensionKeys.map((key) => [key, row[key]])),
      __grouping: grouping,
    };
    const pivotSeries = seriesByValue.get(valueKey(row[pivotKey]));
    if (pivotSeries)
      for (const metricKey of metricKeys)
        target[`${pivotSeries.key}_${metricKey}`] = row[metricKey];
    pivoted.set(rowKey, target);
  }
  return { rows: [...pivoted.values()], series };
}

export function withComparisonSeries(
  rows: Record<string, unknown>[],
  comparisonRows: Record<string, unknown>[],
  alignment: 'key' | 'index' = 'index',
  metricNames?: string[],
) {
  const [dimension, ...rowMetrics] = Object.keys(rows[0] ?? comparisonRows[0] ?? {});
  const metrics =
    metricNames ?? (rowMetrics.length ? rowMetrics : Object.keys(comparisonRows[0] ?? {}).slice(1));
  if (!dimension) return { rows, series: [] };
  const occupiedKeys = new Set([
    ...rows.flatMap((row) => Object.keys(row)),
    ...comparisonRows.flatMap((row) => Object.keys(row)),
  ]);
  const comparisonSeries = metrics.map((_, index) => {
    let key = `comparison_${index}`;
    while (occupiedKeys.has(key)) key = `_${key}`;
    occupiedKeys.add(key);
    return key;
  });
  const comparisonsByDimension = new Map(
    comparisonRows.map((row) => [valueKey(row[dimension]), row]),
  );
  const currentDimensions = new Set(rows.map((row) => valueKey(row[dimension])));
  const alignedRows =
    alignment === 'key'
      ? [
          ...rows,
          ...comparisonRows
            .filter((row) => !currentDimensions.has(valueKey(row[dimension])))
            .map((row) => ({
              [dimension]: row[dimension],
              ...Object.fromEntries(metrics.map((metric) => [metric, undefined])),
            })),
        ]
      : rows;
  return {
    rows: alignedRows.map((row, index) => ({
      ...row,
      ...Object.fromEntries(
        metrics.map((metric, metricIndex) => [
          comparisonSeries[metricIndex],
          (alignment === 'key'
            ? comparisonsByDimension.get(valueKey(row[dimension]))
            : comparisonRows[index])?.[metric],
        ]),
      ),
    })),
    series: comparisonSeries,
  };
}

export function alignDateComparisonRows(
  rows: Record<string, unknown>[],
  mode: 'previousPeriod' | 'previousYear',
  currentRange: { start: string; end: string },
  granularity?: ResolvedDateGranularity | 'raw',
) {
  const dimension = Object.keys(rows[0] ?? {})[0];
  if (!dimension) return rows;
  const periodDays =
    Math.round(
      (Date.parse(`${currentRange.end}T00:00:00Z`) -
        Date.parse(`${currentRange.start}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return rows.map((row) => {
    const value = row[dimension];
    const sourceDate =
      value instanceof Date
        ? value
        : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
          ? new Date(`${value.slice(0, 10)}T00:00:00Z`)
          : undefined;
    if (!sourceDate) return row;
    const date = new Date(sourceDate);
    if (mode === 'previousPeriod')
      shiftPreviousPeriodBucket(date, currentRange.start, periodDays, granularity ?? 'raw');
    else if (
      currentRange.start === currentRange.end &&
      currentRange.start.endsWith('-02-29') &&
      ((sourceDate.getUTCMonth() === 1 && sourceDate.getUTCDate() === 28) ||
        (sourceDate.getUTCMonth() === 2 && sourceDate.getUTCDate() === 1))
    ) {
      date.setUTCFullYear(Number(currentRange.start.slice(0, 4)), 1, 29);
    } else {
      const month = date.getUTCMonth();
      date.setUTCFullYear(date.getUTCFullYear() + 1, month, 1);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(sourceDate.getUTCDate(), lastDay));
    }
    return {
      ...row,
      [dimension]:
        value instanceof Date
          ? date
          : `${date.toISOString().slice(0, 10)}${typeof value === 'string' ? value.slice(10) : ''}`,
    };
  });
}

function shiftPreviousPeriodBucket(
  date: Date,
  currentStart: string,
  periodDays: number,
  granularity: ResolvedDateGranularity | 'raw',
) {
  if (granularity === 'raw' || granularity === 'day') {
    date.setUTCDate(date.getUTCDate() + periodDays);
    return;
  }
  const current = bucketStart(new Date(`${currentStart}T00:00:00Z`), granularity);
  const previous = new Date(`${currentStart}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - periodDays);
  const previousBucket = bucketStart(previous, granularity);
  if (granularity === 'week') {
    const days = Math.round((current.valueOf() - previousBucket.valueOf()) / 86_400_000);
    date.setUTCDate(date.getUTCDate() + days);
    return;
  }
  const months =
    (current.getUTCFullYear() - previousBucket.getUTCFullYear()) * 12 +
    current.getUTCMonth() -
    previousBucket.getUTCMonth();
  date.setUTCMonth(date.getUTCMonth() + months, 1);
}

function bucketStart(date: Date, granularity: ResolvedDateGranularity) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  if (granularity === 'week') {
    const mondayOffset = (result.getUTCDay() + 6) % 7;
    result.setUTCDate(result.getUTCDate() - mondayOffset);
  } else if (granularity === 'month') result.setUTCDate(1);
  else if (granularity === 'quarter') {
    result.setUTCMonth(Math.floor(result.getUTCMonth() / 3) * 3, 1);
  } else if (granularity === 'year') result.setUTCMonth(0, 1);
  return result;
}

function valueKey(value: unknown) {
  if (value === null) return 'null:';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  return `${typeof value}:${String(value)}`;
}

export function tableSummaryDefinition(definition: WidgetDefinition): WidgetDefinition | undefined {
  if (definition.type !== 'table' || !definition.showSummaryRow || !definition.dimensions.length)
    return undefined;
  return {
    ...definition,
    dimensions: [],
    resultLimit: { mode: 'top', amount: 1 },
    sort: undefined,
    showSummaryRow: false,
  };
}
