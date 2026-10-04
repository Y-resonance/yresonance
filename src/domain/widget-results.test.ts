import { describe, expect, it } from 'vitest';
import {
  alignDateComparisonRows,
  colorScaleBounds,
  colorScalePosition,
  pieBreakdownRows,
  pivotBreakdownRows,
  pivotTableRows,
  tableSummaryDefinition,
  withComparisonSeries,
} from './widget-results';

describe('widget result shaping', () => {
  const breakdown = [
    { month: 'Jan', channel: 'Search', spend: 10 },
    { month: 'Jan', channel: 'Social', spend: 20 },
    { month: 'Feb', channel: 'Search', spend: 30 },
  ];

  it('pivots breakdown text into bar series', () => {
    expect(pivotBreakdownRows(breakdown)).toEqual({
      rows: [
        { month: 'Jan', breakdown_0: 10, breakdown_1: 20 },
        { month: 'Feb', breakdown_0: 30 },
      ],
      series: [
        { key: 'breakdown_0', label: 'Search', value: 'string:Search' },
        { key: 'breakdown_1', label: 'Social', value: 'string:Social' },
      ],
    });
  });

  it('defines pie breakdowns as labelled slices', () => {
    expect(pieBreakdownRows(breakdown)[0]).toEqual({
      label: 'Jan · Search',
      month: 'Jan',
      spend: 10,
    });
  });

  it('adds comparison values as visible chart series', () => {
    expect(
      withComparisonSeries([{ month: 'Jan', spend: 20 }], [{ month: 'Dec', spend: 10 }]),
    ).toEqual({
      rows: [{ month: 'Jan', spend: 20, comparison_0: 10 }],
      series: ['comparison_0'],
    });
  });

  it('aligns categorical comparisons by their dimension value', () => {
    expect(
      withComparisonSeries(
        [
          { campaign: 'A', spend: 100 },
          { campaign: 'B', spend: 10 },
        ],
        [
          { campaign: 'B', spend: 50 },
          { campaign: 'A', spend: 5 },
        ],
        'key',
      ),
    ).toEqual({
      rows: [
        { campaign: 'A', spend: 100, comparison_0: 5 },
        { campaign: 'B', spend: 10, comparison_0: 50 },
      ],
      series: ['comparison_0'],
    });
  });

  it('keeps dimensions that exist only in the comparison period', () => {
    expect(
      withComparisonSeries(
        [{ campaign: 'A', spend: 100 }],
        [
          { campaign: 'A', spend: 50 },
          { campaign: 'B', spend: 25 },
        ],
        'key',
      ),
    ).toEqual({
      rows: [
        { campaign: 'A', spend: 100, comparison_0: 50 },
        { campaign: 'B', spend: undefined, comparison_0: 25 },
      ],
      series: ['comparison_0'],
    });
  });

  it('normalizes shifted date comparisons without moving sparse buckets', () => {
    expect(
      alignDateComparisonRows(
        [
          { day: '2026-01-01', spend: 5 },
          { day: '2026-01-03', spend: 7 },
        ],
        'previousPeriod',
        { start: '2026-01-04', end: '2026-01-06' },
      ),
    ).toEqual([
      { day: '2026-01-04', spend: 5 },
      { day: '2026-01-06', spend: 7 },
    ]);
  });

  it('aligns calendar buckets across an uneven previous period', () => {
    expect(
      alignDateComparisonRows(
        [
          { week: '2025-12-01', spend: 5 },
          { week: '2025-12-08', spend: 7 },
        ],
        'previousPeriod',
        { start: '2026-01-01', end: '2026-01-30' },
        'week',
      ),
    ).toEqual([
      { week: '2025-12-29', spend: 5 },
      { week: '2026-01-05', spend: 7 },
    ]);
  });

  it('normalizes database date objects', () => {
    expect(
      alignDateComparisonRows(
        [new Date('2025-02-28T00:00:00Z')].map((day) => ({ day })),
        'previousYear',
        {
          start: '2026-01-01',
          end: '2026-12-31',
        },
      ),
    ).toEqual([{ day: new Date('2026-02-28T00:00:00Z') }]);
  });

  it('preserves timestamp precision while shifting comparison dates', () => {
    expect(
      alignDateComparisonRows([{ hour: '2026-01-01T14:30:00.000Z', spend: 5 }], 'previousPeriod', {
        start: '2026-01-02',
        end: '2026-01-02',
      }),
    ).toEqual([{ hour: '2026-01-02T14:30:00.000Z', spend: 5 }]);
  });

  it('aligns a previous-year leap-day comparison to February 29', () => {
    expect(
      alignDateComparisonRows([{ day: '2023-03-01', spend: 5 }], 'previousYear', {
        start: '2024-02-29',
        end: '2024-02-29',
      }),
    ).toEqual([{ day: '2024-02-29', spend: 5 }]);
  });

  it('keeps null, string null, and prototype-like breakdown values distinct', () => {
    const result = pivotBreakdownRows([
      { month: null, channel: null, spend: 10 },
      { month: 'null', channel: 'null', spend: 20 },
      { month: 'Jan', channel: '__proto__', spend: 30 },
    ]);
    expect(result.rows).toEqual([
      { month: null, breakdown_0: 10 },
      { month: 'null', breakdown_1: 20 },
      { month: 'Jan', breakdown_2: 30 },
    ]);
  });

  it('keeps comparison series for sparse breakdowns', () => {
    const current = pivotBreakdownRows([
      { month: 'Jan', channel: 'Search', spend: 10 },
      { month: 'Feb', channel: 'Social', spend: 20 },
    ]);
    const previous = pivotBreakdownRows([
      { month: 'Jan', channel: 'Search', spend: 5 },
      { month: 'Feb', channel: 'Social', spend: 15 },
    ]);
    expect(
      withComparisonSeries(
        current.rows,
        previous.rows,
        'key',
        current.series.map((item) => item.key),
      ),
    ).toEqual({
      rows: [
        { month: 'Jan', breakdown_0: 10, comparison_0: 5, comparison_1: undefined },
        { month: 'Feb', breakdown_1: 20, comparison_0: undefined, comparison_1: 15 },
      ],
      series: ['comparison_0', 'comparison_1'],
    });
  });

  it('avoids comparison key collisions with metric names', () => {
    expect(
      withComparisonSeries(
        [{ day: 'Mon', comparison_0: 10 }],
        [{ day: 'Mon', comparison_0: 5 }],
        'key',
      ),
    ).toEqual({
      rows: [{ day: 'Mon', comparison_0: 10, _comparison_0: 5 }],
      series: ['_comparison_0'],
    });
  });

  it('pivots table metrics while merging subtotal rows across pivot values', () => {
    expect(
      pivotTableRows(
        [
          { platform: 'Meta', placement: 'Feed', month: 'Jan', spend: 10, __grouping: 0 },
          { platform: 'Meta', placement: 'Feed', month: 'Feb', spend: 20, __grouping: 0 },
          { platform: 'Meta', placement: null, month: 'Jan', spend: 10, __grouping: 1 },
          { platform: 'Meta', placement: null, month: 'Feb', spend: 20, __grouping: 1 },
        ],
        ['platform', 'placement'],
        'month',
        ['spend'],
      ),
    ).toEqual({
      rows: [
        {
          platform: 'Meta',
          placement: 'Feed',
          __grouping: 0,
          pivot_0_spend: 10,
          pivot_1_spend: 20,
        },
        {
          platform: 'Meta',
          placement: null,
          __grouping: 1,
          pivot_0_spend: 10,
          pivot_1_spend: 20,
        },
      ],
      series: [
        { key: 'pivot_0', label: 'Jan', value: 'string:Jan' },
        { key: 'pivot_1', label: 'Feb', value: 'string:Feb' },
      ],
    });
  });

  it('builds an unpaged aggregate query for table summaries', () => {
    const definition = {
      type: 'table' as const,
      title: 'Table',
      dataSourceId: 'source',
      dateRangeFieldId: 'date',
      dimensions: [{ fieldId: 'campaign' }],
      metrics: [
        {
          source: { kind: 'field' as const, fieldId: 'spend', aggregation: 'sum' as const },
          dataType: 'number' as const,
        },
      ],
      resultLimit: { mode: 'pagination' as const, amount: 20 },
      showSummaryRow: true,
      sort: [{ target: { kind: 'metric' as const, index: 0 }, direction: 'desc' as const }],
    };
    expect(tableSummaryDefinition(definition)).toMatchObject({
      dimensions: [],
      resultLimit: { mode: 'top', amount: 1 },
      showSummaryRow: false,
      sort: undefined,
    });
  });

  it('scales metrics over data rows only, ignoring totals and empty values', () => {
    expect(
      colorScaleBounds(
        [
          { metric_1: 10, metric_2: null },
          { metric_1: '40', metric_2: 3 },
          { metric_1: 500, metric_2: 900, __grouping: 1 },
        ],
        ['metric_1', 'metric_2', 'metric_3'],
      ),
    ).toEqual({ metric_1: { min: 10, max: 40 }, metric_2: { min: 3, max: 3 } });
  });

  it('places values on the scale, inverted when lower is better', () => {
    const bounds = { min: 10, max: 30 };
    expect(colorScalePosition(15, bounds)).toBe(0.25);
    expect(colorScalePosition(15, bounds, true)).toBe(0.75);
    expect(colorScalePosition(5, { min: 5, max: 5 }, true)).toBe(1);
    expect(colorScalePosition(null, bounds)).toBeUndefined();
  });
});
