import type { SqlDialect } from '#/query/dialect';
import type { Aggregation, FieldRole, SemanticType } from '#/domain/schema';

export interface DatasourceDescription {
  id: string;
  name: string;
  location?: { kind: string };
  connectorType?: string;
  fields: Array<{
    id: string;
    columnName: string;
    canonicalName: string;
    label: string;
    role: FieldRole;
    semanticType: SemanticType;
    defaultAggregation: Aggregation | null;
    description: string | null;
    castTo?: string | null;
    sampleValues?: unknown[] | null;
    cardinality?: number | null;
  }>;
  calculatedFields: Array<{
    id: string;
    canonicalName: string;
    label: string;
    expression: string;
    formulaDialect?: SqlDialect | null;
    role: FieldRole;
    semanticType: SemanticType;
    defaultAggregation: Aggregation | null;
    description: string | null;
  }>;
  libraryMetrics: Array<{
    id: string;
    name: string;
    canonicalName: string;
    expression: string;
    formulaDialect?: SqlDialect | null;
    semanticType: SemanticType;
    description: string | null;
  }>;
}

export type DatasourceFieldOrigin = 'raw' | 'calculated' | 'library';

export interface DatasourceFieldRow {
  /** Unique across origins; ids only collide by accident, the origin prefix removes that. */
  key: string;
  id: string;
  origin: DatasourceFieldOrigin;
  /** How the field is named in the database. Fixed, because metrics and remapping reference it. */
  canonicalName: string;
  label: string;
  role: FieldRole;
  semanticType: SemanticType;
  defaultAggregation: Aggregation | null;
  description: string;
  expression: string;
  formulaDialect?: SqlDialect | null;
  /** Raw fields are patched by column name; library metrics belong to the metric library. */
  columnName?: string;
  editable: boolean;
  sampleValues?: unknown[] | null;
  cardinality?: number | null;
}

export const datasourceFieldOriginLabels: Record<DatasourceFieldOrigin, string> = {
  raw: 'Raw',
  calculated: 'Calculated',
  library: 'Library',
};

/**
 * Flattens the raw fields, calculated fields, and compatible library metrics of a
 * datasource into one table shape. Library metrics are always aggregates, so they
 * take the metric role even though they carry no stored role.
 */
export function datasourceFieldRows(description: DatasourceDescription): DatasourceFieldRow[] {
  return [
    ...description.fields.map((field) => ({
      key: `raw:${field.id}`,
      id: field.id,
      origin: 'raw' as const,
      canonicalName: field.canonicalName,
      label: field.label,
      role: field.role,
      semanticType: field.semanticType,
      defaultAggregation: field.defaultAggregation,
      description: field.description ?? '',
      expression: '',
      columnName: field.columnName,
      editable: true,
      sampleValues: field.sampleValues,
      cardinality: field.cardinality,
    })),
    ...description.calculatedFields.map((field) => ({
      key: `calculated:${field.id}`,
      id: field.id,
      origin: 'calculated' as const,
      canonicalName: field.canonicalName,
      label: field.label,
      role: field.role,
      semanticType: field.semanticType,
      defaultAggregation: field.defaultAggregation,
      description: field.description ?? '',
      expression: field.expression,
      formulaDialect: field.formulaDialect,
      editable: true,
    })),
    ...description.libraryMetrics.map((metric) => ({
      key: `library:${metric.id}`,
      id: metric.id,
      origin: 'library' as const,
      canonicalName: metric.canonicalName,
      label: metric.name,
      role: 'metric' as const,
      semanticType: metric.semanticType,
      defaultAggregation: null,
      description: metric.description ?? '',
      expression: metric.expression,
      editable: false,
    })),
  ];
}
