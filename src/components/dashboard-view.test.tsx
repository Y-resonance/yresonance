import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QueryResultColumn } from '#/domain/query-result';
import type { DashboardWidget } from '#/domain/schema';
import {
  comboChartAxes,
  formatAxisValue,
  formatDimensionLabel,
  formatValue,
  lineChartAxes,
  lineMetricAxis,
  Result,
} from './dashboard-view';

type QueryDefinition = Extract<DashboardWidget['definition'], { title: string }>;
const base = {
  title: 'Result',
  dataSourceId: 'source',
  dateRangeFieldId: 'date',
};
const metric = {
  source: { kind: 'field' as const, fieldId: 'value', aggregation: 'sum' as const },
  dataType: 'number' as const,
};
const dimension: QueryResultColumn = {
  key: 'dimension_1',
  label: 'Account ID',
  kind: 'dimension',
  dataType: 'id',
};
const currency: QueryResultColumn = {
  key: 'metric_1',
  label: 'Spend }; body { color: red; } /*',
  kind: 'metric',
  dataType: 'currency',
  radix: 2,
};

function columnsFor(definition: QueryDefinition): QueryResultColumn[] {
  const dimensionCount =
    definition.type === 'line' || definition.type === 'combo'
      ? 1
      : definition.type === 'bar' || definition.type === 'pie'
        ? definition.breakdownDimension
          ? 2
          : 1
        : definition.type === 'table'
          ? definition.dimensions.length + (definition.pivotDimension ? 1 : 0)
          : 0;
  const metrics =
    definition.type === 'line' || definition.type === 'combo' || definition.type === 'table'
      ? definition.metrics
      : definition.type === 'scorecard' ||
          definition.type === 'gauge' ||
          definition.type === 'bar' ||
          definition.type === 'pie'
        ? [definition.metric]
        : [];
  return [
    ...Array.from({ length: dimensionCount }, (_, index) => ({
      key: `dimension_${index + 1}`,
      label: `Dimension ${index + 1}`,
      kind: 'dimension' as const,
      dataType: 'text' as const,
    })),
    ...metrics.map((item, index) => ({
      key: `metric_${index + 1}`,
      label: `Metric ${index + 1}`,
      kind: 'metric' as const,
      dataType: item.dataType,
      ...(item.displayFormat?.radix === undefined ? {} : { radix: item.displayFormat.radix }),
      ...(item.conditionalFormat ? { conditionalFormat: item.conditionalFormat } : {}),
      ...(item.colorScale ? { colorScale: item.colorScale } : {}),
    })),
  ];
}

function render(
  definition: QueryDefinition,
  rows: Record<string, unknown>[],
  comparisonRows?: Record<string, unknown>[],
  summaryRow?: Record<string, unknown>,
  scaleBounds?: Record<string, { min: number; max: number }>,
) {
  return renderToStaticMarkup(
    <Result
      definition={definition}
      rows={rows}
      columns={columnsFor(definition)}
      comparisonRows={comparisonRows}
      summaryRow={summaryRow}
      scaleBounds={scaleBounds}
      page={0}
      hasMore={false}
      setPage={() => {}}
    />,
  );
}

describe('widget result rendering', () => {
  it('renders scorecard and library-limited gauge values', () => {
    expect(render({ ...base, type: 'scorecard', metric }, [{ metric_1: 42 }])).toContain('42');
    expect(
      render(
        {
          ...base,
          type: 'gauge',
          metric,
          upperLimit: { kind: 'library', libraryMetricId: 'limit' },
        },
        [{ metric_1: 25, upper_limit: 100 }],
      ),
    ).toContain('25 of 100');
  });

  it('renders empty and one-row chart states for line, bar, and pie', () => {
    const line = {
      ...base,
      type: 'line' as const,
      dimension: { fieldId: 'month' },
      metrics: [metric],
    };
    expect(render(line, [])).toContain('No rows');
    expect(render(line, [{ dimension_1: 'Jan', metric_1: 10 }])).toContain(
      '--color-chart_series_0',
    );
    const previousOnly = render(line, [], [{ dimension_1: 'Jan', metric_1: 5 }]);
    expect(previousOnly).not.toContain('No rows');
    expect(previousOnly).toContain('--color-chart_series_1');
    const barMarkup = render(
      {
        ...base,
        type: 'bar',
        metric,
        dimension: { fieldId: 'month' },
        breakdownDimension: { fieldId: 'channel' },
      },
      [{ dimension_1: 'Jan', dimension_2: 'Paid Search', metric_1: 10 }],
      [{ dimension_1: 'Jan', dimension_2: 'Organic Social', metric_1: 5 }],
    );
    expect(barMarkup).toContain('--color-chart_series_0');
    expect(barMarkup).toContain('--color-chart_series_1');
    expect(barMarkup).toContain('--color-chart_series_3');
    expect(barMarkup).not.toContain('--color-Paid Search');
    expect(
      render(
        {
          ...base,
          type: 'pie',
          metric,
          dimension: { fieldId: 'month' },
          breakdownDimension: { fieldId: 'channel' },
        },
        [{ dimension_1: 'Jan', dimension_2: 'Search', metric_1: 10 }],
      ),
    ).toContain('--color-chart_series_0');
  });

  it('renders current and previous mixed-unit series', () => {
    const markup = render(
      {
        ...base,
        type: 'line',
        dimension: { fieldId: 'day' },
        metrics: [metric, { ...metric, dataType: 'percent' }],
      },
      [{ dimension_1: '2026-01-02', metric_1: 10, metric_2: 0.2 }],
      [{ dimension_1: '2026-01-02', metric_1: 8, metric_2: 0.1 }],
    );
    expect(markup).toContain('--color-chart_series_1');
    expect(markup).toContain('--color-chart_series_2');
    expect(markup).toContain('--color-chart_series_3');
  });

  it('assigns two numeric line metrics to separate axes', () => {
    const axes = lineChartAxes([
      { ...currency, key: 'metric_1', label: 'Impressions', dataType: 'number' },
      { ...currency, key: 'metric_2', label: 'Clicks', dataType: 'number' },
    ]);
    expect(axes.map(({ yAxisId, orientation }) => ({ yAxisId, orientation }))).toEqual([
      { yAxisId: 'metric_0', orientation: 'left' },
      { yAxisId: 'metric_1', orientation: 'right' },
    ]);
    expect(lineMetricAxis(2)).toBe('metric_1');
  });

  it('draws combo metrics as bars and lines on the axis each one names', () => {
    const spend = { ...metric, dataType: 'currency' as const, mark: 'bar' as const };
    const ctr = { ...metric, dataType: 'percent' as const, mark: 'line' as const };
    const markup = render(
      {
        ...base,
        type: 'combo',
        dimension: { fieldId: 'day' },
        metrics: [
          { ...spend, axis: 'left' },
          { ...ctr, axis: 'right' },
        ],
        comparison: { mode: 'previousPeriod' },
      },
      [{ dimension_1: 'Jan', metric_1: 1200, metric_2: 0.02 }],
      [{ dimension_1: 'Jan', metric_1: 900, metric_2: 0.03 }],
    );
    expect(markup).toContain('--color-chart_series_3');

    const columns = [
      { ...currency, key: 'metric_1', label: 'Spend' },
      { ...currency, key: 'metric_2', label: 'CTR', dataType: 'percent' as const },
      { ...currency, key: 'metric_3', label: 'Budget' },
    ];
    const axes = comboChartAxes(
      [
        { ...spend, axis: 'right' },
        { ...ctr, axis: 'left' },
        { ...spend, axis: 'right' },
      ],
      columns,
    );
    expect(axes.map(({ axis, column, label }) => ({ axis, key: column.key, label }))).toEqual([
      { axis: 'left', key: 'metric_2', label: 'CTR' },
      { axis: 'right', key: 'metric_1', label: 'Spend, Budget' },
    ]);
    expect(comboChartAxes([{ ...spend, axis: 'right' }], columns)).toHaveLength(1);
  });

  it('renders table summary, comparison label, and empty range', () => {
    const definition: QueryDefinition = {
      ...base,
      type: 'table',
      dimensions: [{ fieldId: 'month' }],
      metrics: [metric],
      resultLimit: { mode: 'pagination', amount: 20 },
      showSummaryRow: true,
      comparison: { mode: 'previousYear' },
    };
    const markup = render(
      definition,
      [{ dimension_1: 'Jan', metric_1: 10 }],
      [{ dimension_1: 'Jan', metric_1: 5 }],
      { metric_1: 10 },
    );
    expect(markup).toContain('Summary');
    expect(markup).toContain('Previous year');
    expect(markup).toContain('1–1');
    expect(render(definition, [])).toContain('0–0');
  });

  it('renders grouped totals and the first matching threshold color', () => {
    const definition: QueryDefinition = {
      ...base,
      type: 'table',
      dimensions: [{ fieldId: 'platform' }, { fieldId: 'placement' }],
      metrics: [
        {
          ...metric,
          conditionalFormat: [
            { comparator: 'gte', value: 100, color: 'positive' },
            { comparator: 'gte', value: 50, color: 'warning' },
          ],
        },
      ],
      resultLimit: { mode: 'top', amount: 20 },
      showSubtotals: true,
      showSummaryRow: true,
    };
    const markup = render(definition, [
      { dimension_1: 'Meta', dimension_2: 'Feed', metric_1: 120, __grouping: 0 },
      { dimension_1: 'Meta', dimension_2: null, metric_1: 120, __grouping: 1 },
      { dimension_1: null, dimension_2: null, metric_1: 120, __grouping: 3 },
    ]);

    expect(markup).toContain('Total');
    expect(markup).toContain('Grand total');
    expect(markup).toContain('bg-emerald-500/20');
    expect(markup).not.toContain('__grouping');
  });

  it('shades heatmap cells from the lowest to the highest data row, leaving totals plain', () => {
    const definition: QueryDefinition = {
      ...base,
      type: 'table',
      dimensions: [{ fieldId: 'platform' }, { fieldId: 'placement' }],
      metrics: [{ ...metric, colorScale: { style: 'heatmap', color: 'positive' } }],
      resultLimit: { mode: 'top', amount: 20 },
      showSubtotals: true,
    };
    const markup = render(definition, [
      { dimension_1: 'Meta', dimension_2: 'Feed', metric_1: 10, __grouping: 0 },
      { dimension_1: 'Meta', dimension_2: 'Reels', metric_1: 20, __grouping: 0 },
      { dimension_1: 'Meta', dimension_2: 'Stories', metric_1: 30, __grouping: 0 },
      { dimension_1: 'Meta', dimension_2: null, metric_1: 60, __grouping: 1 },
    ]);

    expect(markup.match(/var\(--color-emerald-500\) \d+%/g)).toEqual([
      'var(--color-emerald-500) 0%',
      'var(--color-emerald-500) 23%',
      'var(--color-emerald-500) 45%',
    ]);
  });

  it('draws inverted in-cell bars against whole-result bounds of a paged table', () => {
    const definition: QueryDefinition = {
      ...base,
      type: 'table',
      dimensions: [{ fieldId: 'campaign' }],
      metrics: [{ ...metric, colorScale: { style: 'bar', color: 'warning', invert: true } }],
      resultLimit: { mode: 'pagination', amount: 1 },
    };
    const markup = render(
      definition,
      [{ dimension_1: 'Spring', metric_1: 25 }],
      undefined,
      undefined,
      { metric_1: { min: 0, max: 100 } },
    );

    expect(markup).toContain('data-slot="color-scale-bar"');
    expect(markup).toContain('width:75%');
  });

  it('renders pivot values as grouped metric headers', () => {
    const definition: QueryDefinition = {
      ...base,
      type: 'table',
      dimensions: [{ fieldId: 'platform' }, { fieldId: 'placement' }],
      pivotDimension: { fieldId: 'month' },
      metrics: [metric, { ...metric, userDefinedName: 'Clicks' }],
      resultLimit: { mode: 'top', amount: 20 },
      showSubtotals: true,
    };
    const markup = render(definition, [
      {
        dimension_1: 'Meta',
        dimension_2: 'Feed',
        dimension_3: 'Jan',
        metric_1: 10,
        metric_2: 2,
        __grouping: 0,
      },
      {
        dimension_1: 'Meta',
        dimension_2: 'Feed',
        dimension_3: 'Feb',
        metric_1: 20,
        metric_2: 4,
        __grouping: 0,
      },
    ]);

    expect(markup).toContain('colSpan="2"');
    expect(markup).toContain('rowSpan="2"');
    expect(markup).toContain('Jan');
    expect(markup).toContain('Feb');
    expect(markup).not.toContain('Dimension 3');
  });

  it('colours bars individually only while the chart draws one series', () => {
    const bar = {
      ...base,
      type: 'bar' as const,
      metric,
      dimension: { fieldId: 'channel' },
      colorBy: 'category' as const,
    };
    const rows = [
      { dimension_1: 'Paid Search', metric_1: 10 },
      { dimension_1: 'Organic Social', metric_1: 8 },
    ];
    const perBar = render(bar, rows);
    expect(perBar).toContain('--color-chart_bar_0: var(--chart-1)');
    expect(perBar).toContain('--color-chart_bar_1: var(--chart-2)');
    // A comparison adds a second series, so the palette goes back to marking series.
    const withComparison = render({ ...bar, comparison: { mode: 'previousPeriod' } }, rows, [
      { dimension_1: 'Paid Search', metric_1: 6 },
    ]);
    expect(withComparison).not.toContain('chart_bar_');
    expect(withComparison).toContain('--color-chart_series_1');
    // Without the setting a single-series chart keeps one colour for the whole metric.
    expect(render({ ...bar, colorBy: 'series' }, rows)).not.toContain('chart_bar_');
  });

  it('uses stable chart keys while retaining the custom display label', () => {
    const html = renderToStaticMarkup(
      <Result
        definition={{
          type: 'bar',
          title: 'Spend',
          dataSourceId: 'source',
          dateRangeFieldId: 'date',
          dimension: { fieldId: 'account' },
          metric: {
            source: { kind: 'field', fieldId: 'spend', aggregation: 'sum' },
            userDefinedName: currency.label,
            dataType: 'currency',
          },
        }}
        rows={[{ dimension_1: '9223372036854775807', metric_1: '1234.5' }]}
        columns={[dimension, currency]}
        page={0}
        hasMore={false}
        setPage={() => {}}
      />,
    );
    expect(html).toContain('--color-chart_series_0');
    expect(html).not.toContain('--color-Spend');
    expect(html).not.toContain('body { color: red');
  });

  it('renders null and string-null breakdowns as separate stable series', () => {
    const html = renderToStaticMarkup(
      <Result
        definition={{
          type: 'bar',
          title: 'Spend by channel',
          dataSourceId: 'source',
          dateRangeFieldId: 'date',
          dimension: { fieldId: 'account' },
          breakdownDimension: { fieldId: 'channel' },
          metric: {
            source: { kind: 'field', fieldId: 'spend', aggregation: 'sum' },
            dataType: 'currency',
          },
        }}
        rows={[
          { dimension_1: 'A', dimension_2: null, metric_1: '10' },
          { dimension_1: 'A', dimension_2: 'null', metric_1: '20' },
        ]}
        columns={[
          dimension,
          { ...dimension, key: 'dimension_2', label: 'Channel', dataType: 'text' },
          currency,
        ]}
        page={0}
        hasMore={false}
        setPage={() => {}}
      />,
    );
    expect(html).toContain('--color-chart_series_0');
    expect(html).toContain('--color-chart_series_1');
  });

  it('formats metric strings while preserving dimension strings', () => {
    const html = renderToStaticMarkup(
      <Result
        definition={{
          type: 'table',
          title: 'Accounts',
          dataSourceId: 'source',
          dateRangeFieldId: 'date',
          dimensions: [{ fieldId: 'account' }],
          metrics: [
            {
              source: { kind: 'field', fieldId: 'spend', aggregation: 'sum' },
              dataType: 'currency',
              displayFormat: { radix: 2 },
            },
          ],
          resultLimit: { mode: 'top', amount: 10 },
        }}
        rows={[{ dimension_1: '9223372036854775807', metric_1: '1234.5' }]}
        columns={[dimension, currency]}
        page={0}
        hasMore={false}
        setPage={() => {}}
      />,
    );
    expect(html).toContain('9223372036854775807');
    expect(html).toMatch(/1[,.]234[,.]50/u);
  });

  it('applies percent, duration, and radix formatting to numeric strings', () => {
    expect(formatValue('0.125', { ...currency, dataType: 'percent', radix: 1 })).toBe('12.5%');
    expect(formatValue('3661', { ...currency, dataType: 'duration' })).toBe('1h 1m 1s');
    expect(formatValue('3599.6', { ...currency, dataType: 'duration' })).toBe('1h');
    expect(formatValue('1234', { ...currency, dataType: 'number', radix: 0 })).toMatch(/1[,.]234/u);
    expect(formatValue('1234.567', { ...currency, dataType: 'number', radix: 2 })).toMatch(
      /1[,.]234[,.]57/u,
    );
    expect(formatValue('9223372036854775807', dimension)).toBe('9223372036854775807');
    expect(formatValue('9223372036854775807', currency)).toBe('9223372036854775807');
  });

  it('renders date dimensions in the visitor locale instead of the stored timestamp', () => {
    const date: QueryResultColumn = {
      key: 'dimension_1',
      label: 'Day',
      kind: 'dimension',
      dataType: 'date',
    };
    const day = formatDimensionLabel('2026-03-27 00:00:00', date);
    expect(day).not.toContain('00:00:00');
    expect(day).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(2026, 2, 27)),
    );
    // A bucket that carries a real time keeps it, midnight buckets do not.
    expect(formatDimensionLabel('2026-03-27T14:30:00', date)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(2026, 2, 27, 14, 30),
      ),
    );
    expect(formatDimensionLabel('not a date', date)).toBe('not a date');
    expect(formatDimensionLabel('Account 7', dimension)).toBe('Account 7');
  });

  it('abbreviates thousands on chart axes with k', () => {
    expect(formatAxisValue(999, currency)).toBe('999');
    expect(formatAxisValue(35_000, currency)).toBe('35k');
    expect(formatAxisValue(-140_000, currency)).toBe('-140k');
    expect(formatAxisValue(1_000_000, currency)).not.toContain('k');
  });
});
