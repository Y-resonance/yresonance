import { and, eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { createDatabase } from '#/db/client';
import { calculatedFields, dashboards, dataSources, fields, libraryMetrics } from '#/db/schema';
import {
  dashboardDocumentSchema,
  dataSourceLocationSchema,
  datasourceCachePolicySchema,
  fieldRoleSchema,
  semanticTypeSchema,
} from '#/domain/schema';
import type {
  CalculatedFieldRecord,
  DataSourceRecord,
  FieldRecord,
  LibraryMetricRecord,
} from '#/query/types';
import { ApiError } from './errors';

const db = () => createDatabase(env.DB);

export async function loadDashboard(id: string) {
  const row = await db().query.dashboards.findFirst({ where: eq(dashboards.id, id) });
  if (!row) throw new ApiError(404, 'dashboard_not_found', 'Dashboard not found.');
  return { row, document: dashboardDocumentSchema.parse(row.document) };
}

export async function loadDataSource(id: string, workspaceId: string): Promise<DataSourceRecord> {
  const row = await db().query.dataSources.findFirst({
    where: and(eq(dataSources.id, id), eq(dataSources.workspaceId, workspaceId)),
  });
  if (!row) throw new ApiError(404, 'datasource_not_found', 'Datasource not found.');
  return parseDataSource(row);
}

function parseDataSource(row: typeof dataSources.$inferSelect): DataSourceRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    connectorType: row.connectorType,
    location: dataSourceLocationSchema.parse(row.location),
    cachePolicy: datasourceCachePolicySchema.parse(row.cachePolicy ?? { mode: 'default' }),
    version: row.version,
  };
}

function metadataStatements(
  database: ReturnType<typeof db>,
  dataSourceId: string,
  workspaceId: string,
) {
  return [
    database.select().from(fields).where(eq(fields.dataSourceId, dataSourceId)),
    database.select().from(calculatedFields).where(eq(calculatedFields.dataSourceId, dataSourceId)),
    database.select().from(libraryMetrics).where(eq(libraryMetrics.workspaceId, workspaceId)),
  ] as const;
}

export async function loadQueryMetadata(dataSourceId: string, workspaceId: string) {
  const database = db();
  const rows = await database.batch([...metadataStatements(database, dataSourceId, workspaceId)]);
  return parseQueryMetadata(...rows);
}

// One database trip supplies the context shared by validation, hashing and compilation.
export async function loadQueryContext(dataSourceId: string, workspaceId: string) {
  const database = db();
  const [sourceRows, ...metadataRows] = await database.batch([
    database
      .select()
      .from(dataSources)
      .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.workspaceId, workspaceId))),
    ...metadataStatements(database, dataSourceId, workspaceId),
  ]);
  const row = sourceRows[0];
  if (!row) throw new ApiError(404, 'datasource_not_found', 'Datasource not found.');
  return { dataSource: parseDataSource(row), metadata: parseQueryMetadata(...metadataRows) };
}

function parseQueryMetadata(
  fieldRows: (typeof fields.$inferSelect)[],
  calculatedRows: (typeof calculatedFields.$inferSelect)[],
  metricRows: (typeof libraryMetrics.$inferSelect)[],
) {
  const parsedFields: FieldRecord[] = fieldRows.map((field) => ({
    ...field,
    role: fieldRoleSchema.parse(field.role),
    semanticType: semanticTypeSchema.parse(field.semanticType),
    sampleValues: Array.isArray(field.sampleValues) ? field.sampleValues : null,
  }));
  const parsedCalculated: CalculatedFieldRecord[] = calculatedRows.map((field) => ({
    ...field,
    role: fieldRoleSchema.parse(field.role),
    semanticType: semanticTypeSchema.parse(field.semanticType),
  }));
  const parsedMetrics: LibraryMetricRecord[] = metricRows.map((metric) => ({
    ...metric,
    semanticType: semanticTypeSchema.parse(metric.semanticType),
  }));
  return {
    fields: parsedFields,
    calculatedFields: parsedCalculated,
    libraryMetrics: parsedMetrics,
  };
}
