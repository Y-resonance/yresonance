import { describe, expect, it } from 'vitest';
import { hashJson } from './hash';
import { queryCacheState, widgetDependencyState } from './cache';

const definition = {
  type: 'scorecard' as const,
  title: 'Spend',
  dataSourceId: 'source',
  dateRangeFieldId: 'date',
  metric: {
    source: { kind: 'library' as const, libraryMetricId: 'metric_spend' },
    dataType: 'currency' as const,
  },
};

describe('widget dependency cache state', () => {
  it('changes when a calculated field used by a library metric changes', async () => {
    const metadata = {
      fields: [baseField],
      calculatedFields: [
        {
          id: 'calc_cost',
          canonicalName: 'cost_with_tax',
          label: 'Cost with tax',
          expression: 'cost * 1.2',
        },
      ],
      libraryMetrics: [
        {
          id: 'metric_spend',
          canonicalName: 'spend',
          name: 'Spend',
          expression: 'SUM(cost)',
        },
      ],
    };
    const before = await hashJson(widgetDependencyState(definition, metadata));
    const after = await hashJson(
      widgetDependencyState(definition, {
        ...metadata,
        calculatedFields: [{ ...metadata.calculatedFields[0], expression: 'cost * 1.3' }],
      }),
    );
    expect(after).not.toBe(before);
  });

  it('changes for referenced metrics but ignores unrelated metric edits', async () => {
    const metadata = {
      fields: [baseField],
      calculatedFields: [],
      libraryMetrics: [
        { id: 'metric_spend', canonicalName: 'spend', name: 'Spend', expression: 'SUM(cost)' },
        {
          id: 'metric_clicks',
          canonicalName: 'clicks',
          name: 'Clicks',
          expression: 'SUM(clicks)',
        },
      ],
    };
    const before = await hashJson(widgetDependencyState(definition, metadata));
    const relevant = await hashJson(
      widgetDependencyState(definition, {
        ...metadata,
        libraryMetrics: [
          { ...metadata.libraryMetrics[0], expression: 'SUM(cost) * 1.2' },
          metadata.libraryMetrics[1],
        ],
      }),
    );
    const unrelated = await hashJson(
      widgetDependencyState(definition, {
        ...metadata,
        libraryMetrics: [
          metadata.libraryMetrics[0],
          { ...metadata.libraryMetrics[1], expression: 'SUM(clicks) * 2' },
        ],
      }),
    );
    expect(relevant).not.toBe(before);
    expect(unrelated).toBe(before);
  });

  it('changes when query-relevant base field metadata changes', async () => {
    const metadata = {
      fields: [baseField],
      calculatedFields: [],
      libraryMetrics: [
        { id: 'metric_spend', canonicalName: 'spend', name: 'Spend', expression: 'SUM(cost)' },
      ],
    };
    const before = await hashJson(widgetDependencyState(definition, metadata));
    const after = await hashJson(
      widgetDependencyState(definition, {
        ...metadata,
        fields: [{ ...baseField, castTo: 'DOUBLE' }],
      }),
    );
    expect(after).not.toBe(before);
  });

  it('ignores cell formatting while retaining query changes', async () => {
    const metadata = {
      fields: [baseField],
      calculatedFields: [],
      libraryMetrics: [
        { id: 'metric_spend', canonicalName: 'spend', name: 'Spend', expression: 'SUM(cost)' },
      ],
    };
    const before = await hashJson(widgetDependencyState(definition, metadata));
    const formatted = await hashJson(
      widgetDependencyState(
        {
          ...definition,
          metric: {
            ...definition.metric,
            displayFormat: { radix: 2 },
            conditionalFormat: [{ comparator: 'gte', value: 100, color: 'positive' }],
          },
        },
        metadata,
      ),
    );

    expect(formatted).toBe(before);
  });

  it('keeps cached results across title restyling', async () => {
    const metadata = {
      fields: [baseField],
      calculatedFields: [],
      libraryMetrics: [
        { id: 'metric_spend', canonicalName: 'spend', name: 'Spend', expression: 'SUM(cost)' },
      ],
    };
    const before = await hashJson(widgetDependencyState(definition, metadata));
    const restyled = await hashJson(
      widgetDependencyState(
        { ...definition, titleStyle: { size: 'lg', transform: 'uppercase' } },
        metadata,
      ),
    );

    expect(restyled).toBe(before);
  });

  it('separates resolved date boundaries and dashboard timezones', async () => {
    const state = {
      definitionHash: 'definition',
      requestedDateRange: {
        startDate: { relative: { amount: 28, unit: 'day' } },
        endDate: { relative: { amount: 0, unit: 'day' } },
      },
      resolvedDateRange: { start: '2026-08-01', end: '2026-08-29' },
      resolvedControls: [],
      drillPath: [],
      dataSourceConnector: 'duckdb-file',
      dataSourceVersion: 'version',
      timezone: 'Europe/Berlin',
      dateBucketTarget: 60,
    };
    const before = await hashJson(queryCacheState(state));
    const nextDay = await hashJson(
      queryCacheState({
        ...state,
        resolvedDateRange: { start: '2026-08-02', end: '2026-08-30' },
      }),
    );
    const otherTimezone = await hashJson(
      queryCacheState({ ...state, timezone: 'America/New_York' }),
    );
    expect(nextDay).not.toBe(before);
    expect(otherTimezone).not.toBe(before);
  });

  it('separates datasource connectors even when their source version matches', async () => {
    const state = {
      definitionHash: 'definition',
      requestedDateRange: {},
      resolvedDateRange: { start: '2026-08-01', end: '2026-08-29' },
      resolvedControls: [],
      drillPath: [],
      dataSourceConnector: 'duckdb-file',
      dataSourceVersion: 'version',
      timezone: 'Europe/Berlin',
      dateBucketTarget: 60,
    };

    const before = await hashJson(queryCacheState(state));
    const after = await hashJson(
      queryCacheState({ ...state, dataSourceConnector: 'another-connector' }),
    );

    expect(after).not.toBe(before);
  });

  it('separates automatic date buckets for different widget width tiers', async () => {
    const state = {
      definitionHash: 'definition',
      requestedDateRange: {},
      resolvedDateRange: { start: '2026-01-01', end: '2026-12-31' },
      resolvedControls: [],
      drillPath: [],
      dataSourceConnector: 'duckdb-file',
      dataSourceVersion: 'version',
      timezone: 'Europe/Berlin',
      dateBucketTarget: 30,
    };
    const before = await hashJson(queryCacheState(state));
    const after = await hashJson(queryCacheState({ ...state, dateBucketTarget: 60 }));
    expect(after).not.toBe(before);
  });
});

const baseField = {
  id: 'cost',
  columnName: 'MediaCost',
  canonicalName: 'cost',
  label: 'Cost',
  castTo: null,
};
