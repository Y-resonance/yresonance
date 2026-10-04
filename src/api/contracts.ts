import { z } from 'zod';
import {
  aggregationSchema,
  controlStateSchema,
  dataSourceLocationSchema,
  dateRangeSchema,
  fieldRoleSchema,
  gridPlacementSchema,
  semanticTypeSchema,
  timezoneSchema,
  widgetDefinitionSchema,
} from '#/domain/schema';
import {
  datasourceUploadEventSchema,
  prepareDatasourceUploadSchema,
} from '#/domain/datasource-upload';

const dashboardRef = { dashboardId: z.string().min(1), shareToken: z.string().min(1).optional() };

const libraryMetricInputSchema = z.object({
  name: z.string().trim().min(1),
  canonicalName: z.string().trim().min(1).optional(),
  expression: z.string().min(1),
  semanticType: semanticTypeSchema,
  description: z.string().optional(),
});

export const apiRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bootstrap') }),
  z.object({ action: z.literal('listDashboards') }),
  z.object({ action: z.literal('getDashboard'), ...dashboardRef }),
  z.object({ action: z.literal('getSharedDashboard'), shareToken: z.string().min(1) }),
  z.object({
    action: z.literal('createDashboard'),
    name: z.string().trim().min(1),
    dataSourceIds: z.array(z.string()).default([]),
    timezone: timezoneSchema.default('Europe/Berlin'),
    defaultDateRange: dateRangeSchema.optional(),
  }),
  z.object({
    action: z.literal('updateDashboard'),
    dashboardId: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    timezone: timezoneSchema.optional(),
    defaultDateRange: dateRangeSchema.optional(),
  }),
  z.object({ action: z.literal('deleteDashboard'), dashboardId: z.string().min(1) }),
  z.object({
    action: z.literal('duplicateDashboard'),
    dashboardId: z.string().min(1),
    name: z.string().trim().min(1),
    // { [sourceDataSourceId]: targetDataSourceId }. Unmapped datasources stay as they are.
    dataSourceMapping: z.record(z.string().min(1), z.string().min(1)).optional(),
  }),
  z.object({
    action: z.literal('addWidget'),
    dashboardId: z.string().min(1),
    definition: widgetDefinitionSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('updateWidget'),
    dashboardId: z.string().min(1),
    widgetId: z.string().min(1),
    definition: widgetDefinitionSchema,
    libraryMetric: libraryMetricInputSchema.optional(),
  }),
  z.object({
    action: z.literal('removeWidget'),
    dashboardId: z.string().min(1),
    widgetId: z.string().min(1),
  }),
  z.object({
    action: z.literal('moveWidget'),
    dashboardId: z.string().min(1),
    widgetId: z.string().min(1),
    placement: gridPlacementSchema,
  }),
  z.object({
    action: z.literal('updateLayout'),
    dashboardId: z.string().min(1),
    canvasRows: z.number().int().min(10),
    placements: z.array(
      z.object({
        widgetId: z.string().min(1),
        placement: gridPlacementSchema,
      }),
    ),
  }),
  z.object({
    action: z.literal('copyWidget'),
    dashboardId: z.string().min(1),
    fromDashboardId: z.string().min(1),
    widgetId: z.string().min(1),
    targetDataSourceId: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal('previewWidget'),
    dashboardId: z.string().min(1),
    definition: widgetDefinitionSchema,
    width: z.number().int().positive(),
    controlState: controlStateSchema.optional(),
  }),
  z.object({
    action: z.literal('queryWidget'),
    ...dashboardRef,
    widgetId: z.string().min(1),
    controlState: controlStateSchema.optional(),
    page: z.number().int().nonnegative().optional(),
  }),
  z.object({ action: z.literal('explainWidget'), ...dashboardRef, widgetId: z.string().min(1) }),
  z.object({
    action: z.literal('getControlOptions'),
    ...dashboardRef,
    controlId: z.string().min(1),
    search: z.string().optional(),
  }),
  z.object({ action: z.literal('listDataSources') }),
  z.object({ action: z.literal('listLibraryMetrics') }),
  z.object({
    action: z.literal('describeDatasource'),
    dataSourceId: z.string().min(1),
    dashboardId: z.string().min(1).optional(),
    shareToken: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal('listR2Objects'),
    prefix: z.string().optional(),
    cursor: z.string().optional(),
  }),
  prepareDatasourceUploadSchema.extend({ action: z.literal('prepareDatasourceUpload') }),
  z.object({
    action: z.literal('removeDatasourceUpload'),
    key: z.string().min(1),
    cleanupToken: z.string().min(1),
  }),
  datasourceUploadEventSchema.extend({ action: z.literal('trackDatasourceUpload') }),
  z.object({
    action: z.literal('registerDatasource'),
    backend: z.enum(['duckdb', 'clickhouse']).optional(),
    name: z.string().trim().min(1),
    location: dataSourceLocationSchema,
    cleanupToken: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal('updateFieldMetadata'),
    dataSourceId: z.string().min(1),
    dashboardId: z.string().min(1).optional(),
    columnName: z.string().min(1),
    patch: z.object({
      canonicalName: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      role: fieldRoleSchema.optional(),
      semanticType: semanticTypeSchema.optional(),
      defaultAggregation: aggregationSchema.nullable().optional(),
      description: z.string().nullable().optional(),
      hidden: z.boolean().optional(),
      castTo: z.string().nullable().optional(),
    }),
  }),
  z.object({
    action: z.literal('validateCalculatedField'),
    dashboardId: z.string().min(1).optional(),
    dataSourceId: z.string().min(1),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    canonicalName: z.string().trim().min(1).optional(),
    expression: z.string(),
    semanticType: semanticTypeSchema.optional(),
  }),
  z.object({
    action: z.literal('previewCalculatedFieldValues'),
    dashboardId: z.string().min(1).optional(),
    dataSourceId: z.string().min(1),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    canonicalName: z.string().trim().min(1).optional(),
    expression: z.string().min(1),
    semanticType: semanticTypeSchema,
  }),
  z.object({
    action: z.literal('upsertCalculatedField'),
    dashboardId: z.string().min(1).optional(),
    dataSourceId: z.string().min(1),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    canonicalName: z.string().trim().min(1).optional(),
    expression: z.string().min(1),
    role: fieldRoleSchema,
    semanticType: semanticTypeSchema,
    defaultAggregation: aggregationSchema.nullable().optional(),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal('validateMetricExpression'),
    dashboardId: z.string().min(1).optional(),
    dataSourceId: z.string().min(1),
    expression: z.string(),
  }),
  z.object({
    action: z.literal('upsertLibraryMetric'),
    dashboardId: z.string().min(1).optional(),
    id: z.string().optional(),
    ...libraryMetricInputSchema.shape,
  }),
  z.object({
    action: z.literal('shareDashboard'),
    dashboardId: z.string().min(1),
    operation: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('createLink') }),
      z.object({ kind: z.literal('revokeLink'), token: z.string().min(1) }),
      z.object({
        kind: z.literal('grant'),
        userEmail: z.email(),
        role: z.enum(['editor', 'viewer']),
      }),
      z.object({
        kind: z.literal('revoke'),
        userEmail: z.email().optional(),
        userId: z.string().min(1).optional(),
      }),
    ]),
  }),
]);

export type ApiRequest = z.infer<typeof apiRequestSchema>;

export type ApiResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; issues?: unknown } };

export const apiResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string(), issues: z.unknown().optional() }),
  }),
]);
