import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDateRange, type DashboardDocument } from '#/domain/schema';
import type { DataSourceRecord, FieldRecord } from '#/query/types';
import {
  DatasourceError,
  DUCKDB_FILE_CONNECTOR,
  resolveDatasourceConnector,
  type WidgetDatasourceQuery,
} from './contract';

const mocks = vi.hoisted(() => ({
  describeDataSource: vi.fn<
    (dataSource: DataSourceRecord) => Promise<{
      description: Array<{ column_name: string; column_type: string }>;
      samples: Record<string, unknown>[];
    }>
  >(),
  headSourceObject: vi.fn<
    (key: string) => Promise<{
      key: string;
      size: number;
      etag: string;
      uploaded: Date;
    } | null>
  >(),
  listSourceObjects: vi.fn<
    (
      prefix?: string,
      cursor?: string,
    ) => Promise<{
      objects: Array<{ key: string; size: number; etag: string; uploaded: Date }>;
      truncated: boolean;
      cursor?: string;
    }>
  >(),
  runPreparedQuery:
    vi.fn<
      (
        dataSource: DataSourceRecord,
        compile: (source: string) => { sql: string; parameters: unknown[] },
      ) => Promise<Record<string, unknown>[]>
    >(),
}));

vi.mock('cloudflare:workers', () => ({ env: { R2_BUCKET_NAME: 'test-bucket' } }));
vi.mock('#/data/source.server', () => ({
  headSourceObject: mocks.headSourceObject,
  listSourceObjects: mocks.listSourceObjects,
}));
vi.mock('#/query/duckdb.server', () => ({
  describeDataSource: mocks.describeDataSource,
  QueryEngineError: class QueryEngineError extends Error {},
  runPreparedQuery: mocks.runPreparedQuery,
}));

import { duckdbFileConnector } from './duckdb-file.server';

const dataSource: DataSourceRecord = {
  id: 'source',
  workspaceId: 'workspace',
  name: 'Report',
  connectorType: DUCKDB_FILE_CONNECTOR,
  location: { kind: 'object', key: 'ws/workspace/report.csv', format: 'csv' },
  version: 'v1',
};
const dateField: FieldRecord = {
  id: 'date',
  dataSourceId: dataSource.id,
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
};
const costField: FieldRecord = {
  ...dateField,
  id: 'cost',
  columnName: 'MediaCost',
  canonicalName: 'media_cost',
  label: 'Cost',
  role: 'metric',
  semanticType: 'currency',
};
const dashboard: DashboardDocument = {
  id: 'dashboard',
  workspaceId: 'workspace',
  name: 'Dashboard',
  schemaVersion: 2,
  timezone: 'Europe/Berlin',
  defaultDateRange,
  columns: 12,
  canvasRows: 10,
  widgets: [],
  createdBy: 'user',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};
const widgetQuery: WidgetDatasourceQuery = {
  kind: 'widget',
  dashboard,
  definition: {
    type: 'scorecard',
    title: 'Cost',
    dataSourceId: dataSource.id,
    dateRangeFieldId: dateField.id,
    metric: {
      source: { kind: 'field', fieldId: costField.id, aggregation: 'sum' },
      dataType: 'currency',
    },
  },
  metadata: { fields: [dateField, costField], calculatedFields: [], libraryMetrics: [] },
  controlState: {},
};

describe('duckdb-file datasource connector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes the existing file datasource from a domain widget definition', async () => {
    mocks.runPreparedQuery.mockImplementation(
      async (_dataSource: DataSourceRecord, compile: (source: string) => { sql: string }) => {
        const compiled = compile('"yresonance_source"');
        expect(compiled.sql).toContain('FROM "yresonance_source"');
        expect(compiled.sql).toContain('SUM("MediaCost")');
        return [{ metric_1: 42 }];
      },
    );

    const rows = await duckdbFileConnector.executeQuery(dataSource, widgetQuery);

    expect(rows).toEqual([{ metric_1: 42 }]);
    expect(mocks.runPreparedQuery).toHaveBeenCalledWith(dataSource, expect.any(Function));
  });

  it('explains and validates the same domain widget definition', async () => {
    const explanation = duckdbFileConnector.explainQuery(dataSource, widgetQuery);
    await duckdbFileConnector.validateQuery(dataSource, widgetQuery);

    expect(explanation.sql).toContain('FROM "yresonance_source"');
    expect(explanation.sql).toContain('SUM("MediaCost")');
  });

  it('rejects a calculated field whose declared type disagrees with its formula', async () => {
    await expect(
      duckdbFileConnector.validateExpression(dataSource, {
        kind: 'calculatedField',
        canonicalName: 'lower_cost',
        expression: 'lower(media_cost)',
        semanticType: 'count',
        metadata: {
          fields: [dateField, { ...costField, semanticType: 'text' }],
          calculatedFields: [],
        },
      }),
    ).rejects.toThrow(/returns text/u);
  });

  it('inspects a file and returns a stable source version', async () => {
    mocks.headSourceObject.mockResolvedValue({
      key: 'ws/workspace/report.csv',
      size: 128,
      etag: 'etag-1',
      uploaded: new Date('2026-08-31T00:00:00.000Z'),
    });
    mocks.describeDataSource.mockResolvedValue({
      description: [{ column_name: 'MediaCost', column_type: 'DOUBLE' }],
      samples: [{ MediaCost: 42 }],
    });
    const pending = {
      id: dataSource.id,
      workspaceId: dataSource.workspaceId,
      name: dataSource.name,
      connectorType: dataSource.connectorType,
      location: dataSource.location,
    };

    const first = await duckdbFileConnector.inspect(pending);
    const second = await duckdbFileConnector.inspect(pending);

    expect(first.version).toBe(second.version);
    expect(first.description).toEqual([{ column_name: 'MediaCost', column_type: 'DOUBLE' }]);
    expect(mocks.describeDataSource).toHaveBeenCalledWith({
      ...pending,
      version: first.version,
    });
  });

  it('rejects an unsupported persisted connector type', () => {
    expect(() => resolveDatasourceConnector('unknown', [duckdbFileConnector])).toThrowError(
      new DatasourceError(
        'unsupported_datasource_connector',
        'Datasource connector "unknown" is not supported.',
      ),
    );
  });
});
