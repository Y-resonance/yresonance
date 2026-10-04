import { type DatasourceDescription } from '#/domain/datasource-fields';
import { type WidgetDefinition, type Aggregation } from '#/domain/schema';

export interface BuilderDataSource {
  id: string;
  name: string;
}

export type SourceField =
  | DatasourceDescription['fields'][number]
  | DatasourceDescription['calculatedFields'][number];

export type SourceDescription = DatasourceDescription;

export type BuilderType = WidgetDefinition['type'];

export const aggregations: Aggregation[] = [
  'sum',
  'average',
  'count',
  'countDistinct',
  'min',
  'max',
  'median',
  'standardDeviation',
  'variance',
];

export type QueryDefinition = Extract<WidgetDefinition, { dataSourceId: string }>;

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export interface QuerySettingsProps {
  definition: QueryDefinition;
  fields: SourceField[];
  commit: (definition: WidgetDefinition) => Promise<void>;
}
