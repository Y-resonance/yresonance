import type {
  DatasourceCachePolicy,
  DataSourceLocation,
  FieldRole,
  SemanticType,
} from '#/domain/schema';

export interface DataSourceRecord {
  id: string;
  workspaceId: string;
  name: string;
  connectorType: string;
  location: DataSourceLocation;
  cachePolicy?: DatasourceCachePolicy;
  version: string;
}

export interface FieldRecord {
  id: string;
  dataSourceId: string;
  columnName: string;
  canonicalName: string;
  label: string;
  role: FieldRole;
  semanticType: SemanticType;
  description: string | null;
  hidden: boolean;
  castTo: string | null;
  sampleValues: unknown[] | null;
  cardinality: number | null;
}

export interface CalculatedFieldRecord {
  id: string;
  dataSourceId: string;
  canonicalName: string;
  label: string;
  expression: string;
  role: FieldRole;
  semanticType: SemanticType;
  description: string | null;
}

export interface LibraryMetricRecord {
  id: string;
  canonicalName: string;
  name: string;
  expression: string;
  semanticType: SemanticType;
  description: string | null;
}
