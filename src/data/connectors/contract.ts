import type {
  ControlState,
  DashboardDocument,
  SemanticType,
  WidgetDefinition,
} from '#/domain/schema';
import type {
  CalculatedFieldRecord,
  DataSourceRecord,
  FieldRecord,
  LibraryMetricRecord,
} from '#/query/types';

export const DUCKDB_FILE_CONNECTOR = 'duckdb-file';

export interface DatasourceQueryMetadata {
  fields: FieldRecord[];
  calculatedFields: CalculatedFieldRecord[];
  libraryMetrics: LibraryMetricRecord[];
}

export interface WidgetDatasourceQuery {
  kind: 'widget';
  dashboard: DashboardDocument;
  definition: WidgetDefinition;
  metadata: DatasourceQueryMetadata;
  controlState: ControlState;
  resolvedControls?: Array<{ fieldId: string; values: unknown[] }>;
  offset?: number;
  dateBucketTarget?: number;
}

export interface ControlOptionsDatasourceQuery {
  kind: 'controlOptions';
  field: FieldRecord | CalculatedFieldRecord;
  metadata: Pick<DatasourceQueryMetadata, 'fields' | 'calculatedFields'>;
  search?: string;
  direction: 'ASC' | 'DESC';
}

export type DatasourceQuery = WidgetDatasourceQuery | ControlOptionsDatasourceQuery;

export type DatasourceExpression =
  | {
      kind: 'calculatedField';
      id?: string;
      canonicalName: string;
      expression: string;
      semanticType: SemanticType;
      metadata: Pick<DatasourceQueryMetadata, 'fields' | 'calculatedFields'>;
    }
  | {
      kind: 'libraryMetric';
      expression: string;
      semanticType: SemanticType;
      metadata: Pick<DatasourceQueryMetadata, 'fields' | 'calculatedFields'>;
    };

export interface DatasourceInspection {
  version: string;
  description: Array<{ column_name: string; column_type: string }>;
  samples: Record<string, unknown>[];
}

export interface DatasourceQueryExplanation {
  sql: string;
  definitions: Array<{ name: string; expression: string; description: string | null }>;
}

export interface DatasourceConnector {
  readonly type: string;
  inspect(
    dataSource: Omit<DataSourceRecord, 'version'>,
    options?: { maximumObjectBytes?: number },
  ): Promise<DatasourceInspection>;
  executeQuery<T extends Record<string, unknown>>(
    dataSource: DataSourceRecord,
    query: DatasourceQuery,
  ): Promise<T[]>;
  validateQuery(dataSource: DataSourceRecord, query: WidgetDatasourceQuery): Promise<void>;
  explainQuery(
    dataSource: DataSourceRecord,
    query: WidgetDatasourceQuery,
  ): DatasourceQueryExplanation;
  validateExpression(dataSource: DataSourceRecord, expression: DatasourceExpression): Promise<void>;
}

export type DatasourceErrorCode =
  | 'datasource_access_denied'
  | 'datasource_source_not_found'
  | 'datasource_source_too_large'
  | 'datasource_inspection_failed'
  | 'invalid_query'
  | 'unsupported_datasource_connector'
  | 'datasource_connector_failed';

export class DatasourceError extends Error {
  constructor(
    public readonly code: DatasourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function resolveDatasourceConnector<T extends DatasourceConnector>(
  connectorType: string,
  connectors: readonly T[],
) {
  const connector = connectors.find((candidate) => candidate.type === connectorType);
  if (connector) return connector;
  throw new DatasourceError(
    'unsupported_datasource_connector',
    `Datasource connector "${connectorType}" is not supported.`,
  );
}
