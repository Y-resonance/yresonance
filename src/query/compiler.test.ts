import { describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { pivotTableRows } from '#/domain/widget-results';
import { defaultDateRange, type DashboardDocument, type WidgetDefinition } from '#/domain/schema';
import {
  assertCalculatedFieldNameAvailable,
  compileLibraryExpression,
  compileSourceSqlFromBaseUrl,
  compileWidgetQuery,
  validateRowFormula,
} from './compiler';
import type {
  CalculatedFieldRecord,
  DataSourceRecord,
  FieldRecord,
  LibraryMetricRecord,
} from './types';

const dataSource: DataSourceRecord = {
  id: 'source',
  workspaceId: 'workspace',
  name: 'Report',
  connectorType: 'duckdb-file',
  location: { kind: 'object', key: 'ws/workspace/report.csv', format: 'csv' },
  version: 'v1',
};
const fields: FieldRecord[] = [
  {
    id: 'date',
    dataSourceId: 'source',
    columnName: 'DateStart',
    canonicalName: 'date',
    label: 'Date',
    role: 'dimension',
    semanticType: 'date',
    description: null,
    hidden: false,
    castTo: null,
    sampleValues: null,
    cardinality: null,
  },
  {
    id: 'campaign',
    dataSourceId: 'source',
    columnName: 'Campaign',
    canonicalName: 'campaign',
    label: 'Campaign',
    role: 'dimension',
    semanticType: 'text',
    description: null,
    hidden: false,
    castTo: null,
    sampleValues: null,
    cardinality: null,
  },
  {
    id: 'platform',
    dataSourceId: 'source',
    columnName: 'Platform',
    canonicalName: 'platform',
    label: 'Platform',
    role: 'dimension',
    semanticType: 'text',
    description: null,
    hidden: false,
    castTo: null,
    sampleValues: null,
    cardinality: null,
  },
  {
    id: 'cost',
    dataSourceId: 'source',
    columnName: 'MediaCost',
    canonicalName: 'media_cost',
    label: 'Cost',
    role: 'metric',
    semanticType: 'currency',
    description: null,
    hidden: false,
    castTo: null,
    sampleValues: null,
    cardinality: null,
  },
];
const dashboard: DashboardDocument = {
  id: 'dashboard',
  workspaceId: 'workspace',
  name: 'Test',
  schemaVersion: 2,
  timezone: 'Europe/Berlin',
  defaultDateRange,
  columns: 12,
  canvasRows: 10,
  widgets: [],
  createdBy: 'user',
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
};

function compileScorecard(
  metric: Extract<WidgetDefinition, { type: 'scorecard' }>['metric'],
  libraryMetrics: LibraryMetricRecord[] = [],
) {
  return compileWidgetQuery({
    dashboard,
    definition: {
      type: 'scorecard',
      title: 'Metric',
      dataSourceId: 'source',
      dateRangeFieldId: 'date',
      metric,
    },
    dataSource,
    fields,
    calculatedFields: [],
    libraryMetrics,
    controlState: {},
    bucketName: 'bucket',
    sourceSql: '"yresonance_source"',
  });
}

describe('query compiler', () => {
  const calculatedFields: CalculatedFieldRecord[] = [
    {
      id: 'net-cost',
      dataSourceId: 'source',
      canonicalName: 'net_cost',
      label: 'Net cost',
      expression: 'media_cost * 0.8',
      role: 'metric',
      semanticType: 'currency',
      description: null,
    },
    {
      id: 'doubled-net-cost',
      dataSourceId: 'source',
      canonicalName: 'doubled_net_cost',
      label: 'Doubled net cost',
      expression: 'net_cost * 2',
      role: 'metric',
      semanticType: 'currency',
      description: null,
    },
  ];

  it('inlines chained calculated fields in dependency order', () => {
    expect(
      validateRowFormula('doubled_net_cost + net_cost', { fields, calculatedFields }).sql,
    ).toContain('"MediaCost" * 0.8');
  });

  it('names calculated field cycles and self-references', () => {
    expect(() =>
      validateRowFormula('first', {
        fields,
        calculatedFields: [
          { ...calculatedFields[0], id: 'first', canonicalName: 'first', expression: 'second' },
          { ...calculatedFields[1], id: 'second', canonicalName: 'second', expression: 'first' },
        ],
      }),
    ).toThrow('Calculated field cycle: first -> second -> first.');
    expect(() =>
      validateRowFormula('self', {
        fields,
        calculatedFields: [
          { ...calculatedFields[0], id: 'self', canonicalName: 'self', expression: 'self + 1' },
        ],
      }),
    ).toThrow('Calculated field cycle: self -> self.');
  });

  it('rejects raw and calculated canonical name collisions', () => {
    expect(() =>
      assertCalculatedFieldNameAvailable('MEDIA_COST', { fields, calculatedFields }),
    ).toThrow(/already used by raw field Cost/u);
    expect(() =>
      assertCalculatedFieldNameAvailable('NET_COST', { fields, calculatedFields }),
    ).toThrow(/already used by Net cost/u);
    expect(() =>
      assertCalculatedFieldNameAvailable('net_cost', { fields, calculatedFields }, 'net-cost'),
    ).not.toThrow();
  });

  it('compiles explicit local files into an HTTP source', () => {
    expect(
      compileSourceSqlFromBaseUrl(dataSource, 'http://localhost:3000/__dev-data', [
        'ws/workspace/report one.csv',
        'ws/workspace/report two.csv',
      ]),
    ).toBe(
      "read_csv_auto(['http://localhost:3000/__dev-data/ws/workspace/report%20one.csv', 'http://localhost:3000/__dev-data/ws/workspace/report%20two.csv'], header = true)",
    );
  });

  it('compiles stored fields, controls, aggregation, ordering, and limits against the isolated table', () => {
    const result = compileWidgetQuery({
      dashboard,
      definition: {
        type: 'table',
        title: 'Cost',
        dataSourceId: 'source',
        dateRangeFieldId: 'date',
        dimensions: [{ fieldId: 'campaign' }],
        metrics: [
          { source: { kind: 'field', fieldId: 'cost', aggregation: 'sum' }, dataType: 'currency' },
        ],
        resultLimit: { mode: 'top', amount: 20 },
        sort: [{ target: { kind: 'metric', index: 0 }, direction: 'desc' }],
      },
      dataSource,
      fields,
      calculatedFields: [],
      libraryMetrics: [],
      controlState: {},
      bucketName: 'bucket',
      sourceSql: '"yresonance_source"',
      resolvedControls: [{ fieldId: 'campaign', values: ['Alpha'] }],
    });
    expect(result.sql).toContain('FROM "yresonance_source"');
    expect(result.sql).toContain('"Campaign" IN (?)');
    expect(result.sql).toContain('GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 20');
    expect(result.parameters.at(-1)).toBe('Alpha');
  });

  it('fetches one extra table row when paging so the viewer can offer next', () => {
    const result = compileWidgetQuery({
      dashboard,
      definition: {
        type: 'table',
        title: 'Cost',
        dataSourceId: 'source',
        dateRangeFieldId: 'date',
        dimensions: [{ fieldId: 'campaign' }],
        metrics: [
          { source: { kind: 'field', fieldId: 'cost', aggregation: 'sum' }, dataType: 'currency' },
        ],
        resultLimit: { mode: 'pagination', amount: 20 },
      },
      dataSource,
      fields,
      calculatedFields: [],
      libraryMetrics: [],
      controlState: {},
      bucketName: 'bucket',
      sourceSql: '"yresonance_source"',
      offset: 40,
    });
    expect(result.sql).toContain('LIMIT 21 OFFSET 40');
    expect(result.sql).toContain('ORDER BY 1 ASC');
  });

  it('buckets date dimensions to the widget target', () => {
    const result = compileWidgetQuery({
      dashboard,
      definition: {
        type: 'line',
        title: 'Cost by date',
        dataSourceId: 'source',
        dateRangeFieldId: 'date',
        dimension: { fieldId: 'date', dateGranularity: 'auto' },
        metrics: [
          { source: { kind: 'field', fieldId: 'cost', aggregation: 'sum' }, dataType: 'currency' },
        ],
      },
      dataSource,
      fields,
      calculatedFields: [],
      libraryMetrics: [],
      controlState: {
        dateRange: {
          startDate: { fixed: '2026-01-01' },
          endDate: { fixed: '2026-12-31' },
        },
      },
      bucketName: 'bucket',
      sourceSql: '"yresonance_source"',
      dateBucketTarget: 30,
    });

    expect(result.sql).toContain(`DATE_TRUNC('month', "DateStart") AS "dimension_1"`);
    expect(result.sql).toContain('GROUP BY 1 ORDER BY 1 ASC');
  });

  describe.each([false, true])('table totals with pivot=%s', (pivot) => {
    it.each([
      { showSubtotals: false, showSummaryRow: false, groups: [0, 0, 0] },
      { showSubtotals: true, showSummaryRow: false, groups: [0, 0, 1, 0, 1] },
      { showSubtotals: false, showSummaryRow: true, groups: [0, 0, 0, 3] },
      { showSubtotals: true, showSummaryRow: true, groups: [0, 0, 1, 0, 1, 3] },
    ])('subtotals=$showSubtotals summary=$showSummaryRow', async ({ groups, ...toggles }) => {
      const instance = await DuckDBInstance.create(':memory:');
      const connection = await instance.connect();
      try {
        const compiled = compileWidgetQuery({
          dashboard: {
            ...dashboard,
            defaultDateRange: {
              startDate: { fixed: '2026-08-01' },
              endDate: { fixed: '2026-08-31' },
            },
          },
          definition: {
            type: 'table',
            title: 'Cost',
            dataSourceId: 'source',
            dateRangeFieldId: 'date',
            dimensions: [{ fieldId: 'platform' }, { fieldId: 'campaign' }],
            ...(pivot ? { pivotDimension: { fieldId: 'date' } } : {}),
            metrics: [
              {
                source: { kind: 'field', fieldId: 'cost', aggregation: 'sum' },
                dataType: 'currency',
              },
            ],
            resultLimit: { mode: 'top', amount: 50 },
            ...toggles,
          },
          dataSource,
          fields,
          calculatedFields: [],
          libraryMetrics: [],
          controlState: {},
          bucketName: 'bucket',
          sourceSql: `(VALUES
            ('Meta', 'Feed', DATE '2026-08-01', 10),
            ('Meta', 'Feed', DATE '2026-08-02', 20),
            ('Meta', 'Stories', DATE '2026-08-01', 30),
            ('Search', 'Feed', DATE '2026-08-01', 40)
          ) AS source("Platform", "Campaign", "DateStart", "MediaCost")`,
        });
        const rawRows = (
          await connection.runAndReadAll(compiled.sql, compiled.parameters.map(String))
        ).getRowObjectsJson();
        const rows = pivot
          ? pivotTableRows(rawRows, ['dimension_1', 'dimension_2'], 'dimension_3', ['metric_1'])
              .rows
          : rawRows;
        expect(rows.map((row) => Number(row.__grouping ?? 0))).toEqual(groups);
        const totals = rows.filter((row) => Number(row.__grouping ?? 0) > 0);
        expect(totals.map((row) => row.dimension_1)).toEqual([
          ...(toggles.showSubtotals ? ['Meta', 'Search'] : []),
          ...(toggles.showSummaryRow ? [null] : []),
        ]);
        expect(
          totals.map((row) =>
            Object.entries(row)
              .filter(([key]) => key.endsWith('metric_1'))
              .reduce((sum, [, value]) => sum + Number(value), 0),
          ),
        ).toEqual([
          ...(toggles.showSubtotals ? [60, 40] : []),
          ...(toggles.showSummaryRow ? [100] : []),
        ]);
      } finally {
        connection.closeSync();
        instance.closeSync();
      }
    });
  });

  it('selects a library-driven gauge upper limit', () => {
    const result = compileWidgetQuery({
      dashboard,
      definition: {
        type: 'gauge',
        title: 'Spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'date',
        metric: {
          source: { kind: 'field', fieldId: 'cost', aggregation: 'sum' },
          dataType: 'currency',
        },
        upperLimit: { kind: 'library', libraryMetricId: 'budget' },
      },
      dataSource,
      fields,
      calculatedFields: [],
      libraryMetrics: [
        {
          id: 'budget',
          name: 'Budget',
          canonicalName: 'budget',
          expression: '1000',
          semanticType: 'currency',
          description: null,
        },
      ],
      controlState: {},
      bucketName: 'bucket',
      sourceSql: '"yresonance_source"',
    });
    expect(result.sql).toContain('1000 AS "upper_limit"');
  });

  it('rewrites canonical library fields to raw datasource columns', () => {
    expect(compileLibraryExpression('SUM(media_cost)', { fields, calculatedFields: [] })).toBe(
      'SUM("MediaCost")',
    );
  });

  it.each(['sum', 'min', 'max'] as const)(
    'rejects %s over text fields during static validation',
    (aggregation) => {
      expect(() =>
        compileScorecard({
          source: { kind: 'field', fieldId: 'campaign', aggregation },
          dataType: 'number',
        }),
      ).toThrow(/requires a numeric field/u);
    },
  );

  it('rejects text widget expressions during static validation', () => {
    expect(() =>
      compileScorecard({
        source: { kind: 'expression', expression: "'not a number'" },
        dataType: 'currency',
      }),
    ).toThrow(/must return a number/u);
  });

  it('rejects text library metrics during static validation', () => {
    expect(() =>
      compileScorecard(
        {
          source: { kind: 'library', libraryMetricId: 'text-metric' },
          dataType: 'number',
        },
        [
          {
            id: 'text-metric',
            name: 'Text metric',
            canonicalName: 'text_metric',
            expression: "'not a number'",
            semanticType: 'text',
            description: null,
          },
        ],
      ),
    ).toThrow(/must return a number/u);
  });

  it('does not rewrite canonical names inside formula string literals', () => {
    const paid = {
      ...fields[0],
      id: 'paid',
      canonicalName: 'paid',
      columnName: 'Paid',
    };
    expect(
      compileLibraryExpression(`sum(if(campaign = 'paid', media_cost, 0))`, {
        fields: [...fields, paid],
        calculatedFields: [],
      }),
    ).toBe(`SUM(CASE WHEN ("Campaign" = 'paid') THEN "MediaCost" ELSE 0 END)`);
  });

  it('rewrites quoted canonical identifiers without double quoting them', () => {
    expect(compileLibraryExpression('SUM("media_cost")', { fields, calculatedFields: [] })).toBe(
      'SUM("MediaCost")',
    );
  });

  it('prefers a raw field when a calculated field has the same canonical name', () => {
    expect(
      compileLibraryExpression('SUM(media_cost)', {
        fields,
        calculatedFields: [
          {
            id: 'calculated-cost',
            dataSourceId: 'source',
            canonicalName: 'media_cost',
            label: 'Calculated cost',
            expression: 'media_cost * 2',
            role: 'metric',
            semanticType: 'currency',
            description: null,
          },
        ],
      }),
    ).toBe('SUM("MediaCost")');
  });

  it('uses the raw field for a stored library metric with a colliding calculated name', () => {
    const result = compileWidgetQuery({
      dashboard,
      definition: {
        type: 'scorecard',
        title: 'Cost',
        dataSourceId: 'source',
        dateRangeFieldId: 'date',
        metric: {
          source: { kind: 'library', libraryMetricId: 'metric' },
          dataType: 'currency',
        },
      },
      dataSource,
      fields,
      calculatedFields: [
        {
          id: 'calculated-cost',
          dataSourceId: 'source',
          canonicalName: 'media_cost',
          label: 'Calculated cost',
          expression: 'media_cost * 2',
          role: 'metric',
          semanticType: 'currency',
          description: null,
        },
      ],
      libraryMetrics: [
        {
          id: 'metric',
          name: 'Cost',
          canonicalName: 'cost',
          expression: 'SUM(media_cost)',
          semanticType: 'currency',
          description: null,
        },
      ],
      controlState: {},
      bucketName: 'bucket',
      sourceSql: '"yresonance_source"',
    });
    expect(result.sql).toContain('SELECT SUM("MediaCost") AS "metric_1"');
  });

  it('keeps custom names out of result aliases', () => {
    const result = compileWidgetQuery({
      dashboard,
      definition: {
        type: 'line',
        title: 'Spend',
        dataSourceId: 'source',
        dateRangeFieldId: 'date',
        dimension: { fieldId: 'campaign', userDefinedName: 'Campaign label' },
        metrics: [
          {
            source: { kind: 'field', fieldId: 'cost', aggregation: 'sum' },
            userDefinedName: 'Spend }; body { color: red; } /*',
            dataType: 'currency',
          },
        ],
      },
      dataSource,
      fields,
      calculatedFields: [],
      libraryMetrics: [],
      controlState: {},
      bucketName: 'bucket',
      sourceSql: '"yresonance_source"',
    });

    expect(result.sql).toContain('"Campaign" AS "dimension_1"');
    expect(result.sql).toContain('SUM("MediaCost") AS "metric_1"');
    expect(result.sql).not.toContain('Campaign label');
    expect(result.sql).not.toContain('body');
  });

  it('rejects SQL aliases and casts while allowing the same text in string literals', () => {
    expect(() =>
      compileLibraryExpression('SUM(media_cost) AS total', { fields, calculatedFields: [] }),
    ).toThrow(/Unexpected/u);
    expect(() =>
      compileLibraryExpression(`sum(if(campaign = 'AS', media_cost, 0))`, {
        fields,
        calculatedFields: [],
      }),
    ).not.toThrow();
    expect(() =>
      compileLibraryExpression('SUM(CAST(media_cost AS DOUBLE))', {
        fields,
        calculatedFields: [],
      }),
    ).toThrow(/closing parenthesis/u);
  });

  it('rejects SQL syntax in formulas', () => {
    expect(() =>
      compileLibraryExpression('sum(media_cost); select 1', { fields, calculatedFields: [] }),
    ).toThrow(/Unexpected/u);
    expect(() =>
      compileLibraryExpression('sum(media_cost) -- ignore', { fields, calculatedFields: [] }),
    ).toThrow(/Unknown formula/u);
  });
});
