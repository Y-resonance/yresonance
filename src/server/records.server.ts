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

export async function loadQueryMetadata(dataSourceId: string, workspaceId: string) {
  const database = db();
  const [fieldRows, calculatedRows, metricRows] = await Promise.all([
    database.select().from(fields).where(eq(fields.dataSourceId, dataSourceId)),
    database.select().from(calculatedFields).where(eq(calculatedFields.dataSourceId, dataSourceId)),
    database.select().from(libraryMetrics).where(eq(libraryMetrics.workspaceId, workspaceId)),
  ]);
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
