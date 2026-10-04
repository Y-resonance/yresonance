import { useEffect, useState } from 'react';
import { z } from 'zod';
import { callApi } from '#/api/client';
import { apiRequestSchema, type ApiRequest } from '#/api/contracts';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>, options?: { signal: AbortSignal }) => Promise<unknown>;
}

interface ModelContext {
  registerTool(tool: ToolDefinition, options?: { signal: AbortSignal }): Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

interface WebMcpOptions {
  dashboardId?: string;
  shareToken?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canManageDataSources?: boolean;
  isAdmin?: boolean;
  onToolUse?: (action: ApiRequest['action']) => void;
  onMutation?: () => void | Promise<void>;
}

interface ToolSpec {
  action: ApiRequest['action'];
  description: string;
  readOnly: boolean;
  fixed?: Record<string, unknown>;
}

const duplicateDashboardDescription =
  'Copy a dashboard under a new name. dataSourceMapping ({ sourceId: targetId }) points widgets at another datasource, matching fields by canonical name. Fails without storing anything and lists the unmatched canonical fields per widget when the target lacks them. Share links and grants are not copied. Returns the new dashboard.';

export function useWebMcpTools(options: WebMcpOptions) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (typeof document.modelContext?.registerTool !== 'function') return;
    setAvailable(true);
    const controller = new AbortController();
    const fixed = options.dashboardId
      ? {
          dashboardId: options.dashboardId,
          ...(options.shareToken ? { shareToken: options.shareToken } : {}),
        }
      : {};
    const viewTools: ToolSpec[] = [
      ...(!options.shareToken
        ? ([
            {
              action: 'listDashboards',
              description:
                'List dashboards the signed-in user can see. Returns ids, names, widget counts, and update times.',
              readOnly: true,
            },
            {
              action: 'listLibraryMetrics',
              description: 'List aggregate metrics in the active workspace library.',
              readOnly: true,
            },
          ] satisfies ToolSpec[])
        : []),
      ...(options.dashboardId
        ? ([
            {
              action: 'getDashboard',
              description:
                'Read the open dashboard, including widget definitions, controls, placements, canvas row count, timezone, and datasource names.',
              readOnly: true,
              fixed,
            },
            {
              action: 'queryWidget',
              description:
                'Run a stored widget from the open dashboard with optional dashboard control state. Viewers cannot submit SQL or field names. Returns rows and applied control state.',
              readOnly: true,
              fixed,
            },
            {
              action: 'explainWidget',
              description:
                'Explain a stored widget from the open dashboard. Returns compiled SQL and the formula definitions used by its metrics.',
              readOnly: true,
              fixed,
            },
            {
              action: 'getControlOptions',
              description:
                'Get up to 100 selectable values for one control on the open dashboard, optionally narrowed by search.',
              readOnly: true,
              fixed,
            },
            {
              action: 'describeDatasource',
              description:
                'Describe a datasource used by the open dashboard. Returns visible fields, semantics, samples, calculated fields, and applicable library metrics.',
              readOnly: true,
              fixed,
            },
          ] satisfies ToolSpec[])
        : []),
      ...(options.canManageDataSources
        ? ([
            {
              action: 'listDataSources',
              description: 'List datasources registered in the active workspace.',
              readOnly: true,
            },
          ] satisfies ToolSpec[])
        : []),
    ];
    const editTools: ToolSpec[] =
      options.canEdit && options.dashboardId
        ? [
            {
              action: 'updateDashboard',
              description: 'Update the open dashboard name, timezone, or default date range.',
              readOnly: false,
              fixed,
            },
            {
              action: 'addWidget',
              description:
                'Validate and append a widget to the open dashboard. Provide its full definition and size. Table metrics can include ordered conditionalFormat threshold rules; tables with two or more dimensions can set showSubtotals, and pivotDimension creates grouped columns. Bar charts take colorBy to paint one color per metric or one per bar. Card titles take titleStyle and text widgets take textStyle. yresonance computes its coordinates.',
              readOnly: false,
              fixed,
            },
            {
              action: 'updateWidget',
              description:
                'Replace a widget definition on the open dashboard after reading it with getDashboard. Table metrics support ordered conditionalFormat threshold rules with semantic colors, showSubtotals groups by the first dimension, and pivotDimension creates grouped columns. Bar charts take colorBy to paint one color per metric or one per bar. Card titles take titleStyle and text widgets take textStyle.',
              readOnly: false,
              fixed,
            },
            {
              action: 'removeWidget',
              description: 'Permanently remove a widget from the open dashboard.',
              readOnly: false,
              fixed,
            },
            {
              action: 'moveWidget',
              description:
                'Move or resize a widget on the open dashboard. The placement must stay inside the grid and cannot overlap.',
              readOnly: false,
              fixed,
            },
            {
              action: 'updateLayout',
              description:
                'Replace every widget placement and the canvas row count on the open dashboard in one validated write. Include all placements. Empty rows are allowed, but widgets cannot overlap or leave the 12-column grid.',
              readOnly: false,
              fixed,
            },
            {
              action: 'duplicateDashboard',
              description: duplicateDashboardDescription,
              readOnly: false,
              fixed,
            },
            {
              action: 'copyWidget',
              description:
                'Copy a widget from another visible dashboard into the open dashboard. Optionally select a target datasource; referenced fields are remapped by canonical name.',
              readOnly: false,
              fixed,
            },
            {
              action: 'previewWidget',
              description:
                'Compile and run an unsaved widget definition without storing it. Width controls automatic date bucketing.',
              readOnly: true,
              fixed,
            },
            {
              action: 'validateCalculatedField',
              description:
                'Validate a row-level calculated field without saving it. Returns its type and referenced field IDs, or an error position.',
              readOnly: true,
              fixed,
            },
            {
              action: 'upsertCalculatedField',
              description:
                'Create or update a row-level yresonance formula after static syntax, field, and type validation.',
              readOnly: false,
              fixed,
            },
            {
              action: 'validateMetricExpression',
              description:
                'Validate an aggregate metric formula without saving it. Every field reference must sit inside an aggregate function.',
              readOnly: true,
              fixed,
            },
            {
              action: 'updateFieldMetadata',
              description:
                'Update visible field metadata for a datasource used by the open dashboard. Hiding, casting, and canonical names remain admin-only.',
              readOnly: false,
              fixed,
            },
            {
              action: 'upsertLibraryMetric',
              description:
                'Create or update a workspace aggregate metric written against canonical field names.',
              readOnly: false,
              fixed,
            },
            {
              action: 'shareDashboard',
              description:
                'Create or revoke an unlisted link, or grant or revoke a user role on the open dashboard. This changes access.',
              readOnly: false,
              fixed,
            },
          ]
        : [];
    const createTools: ToolSpec[] = options.canCreate
      ? [
          {
            action: 'createDashboard',
            description:
              'Create a dashboard in the active workspace. This stores a new dashboard and grants the creator editor access.',
            readOnly: false,
          },
        ]
      : [];
    const overviewTools: ToolSpec[] =
      options.canCreate && !options.dashboardId
        ? [
            {
              action: 'updateDashboard',
              description:
                'Rename a dashboard or update its timezone or default date range. Requires editor access.',
              readOnly: false,
            },
            {
              action: 'shareDashboard',
              description:
                'Create or revoke read-only dashboard links, or manage user grants. Requires editor access and changes access.',
              readOnly: false,
            },
            {
              action: 'duplicateDashboard',
              description: duplicateDashboardDescription,
              readOnly: false,
            },
            {
              action: 'deleteDashboard',
              description:
                'Permanently delete a dashboard and all its share links and user grants. Datasources are kept. Requires editor access.',
              readOnly: false,
            },
          ]
        : [];
    const dataSourceTools: ToolSpec[] = options.canManageDataSources
      ? [
          {
            action: 'listR2Objects',
            description: 'List R2 objects only under the active workspace prefix.',
            readOnly: true,
          },
          {
            action: 'registerDatasource',
            description:
              'Register DuckDB files or an authorized external ClickHouse table. Choose backend for managed uploads. Inspects the source and returns datasource and field metadata.',
            readOnly: false,
          },
        ]
      : [];
    const adminTools: ToolSpec[] = options.isAdmin
      ? [
          ...(!options.dashboardId
            ? ([
                {
                  action: 'validateCalculatedField',
                  description:
                    'Validate a row-level calculated field without saving it. Returns its type and referenced field IDs, or an error position.',
                  readOnly: true,
                },
                {
                  action: 'upsertCalculatedField',
                  description:
                    'Create or update a row-level yresonance formula after static syntax, field, and type validation.',
                  readOnly: false,
                },
                {
                  action: 'validateMetricExpression',
                  description:
                    'Validate an aggregate metric formula without saving it. Every field reference must sit inside an aggregate function.',
                  readOnly: true,
                },
                {
                  action: 'updateFieldMetadata',
                  description:
                    'Update field semantics, label, canonical name, visibility, description, default aggregation, or cast override.',
                  readOnly: false,
                },
                {
                  action: 'upsertLibraryMetric',
                  description:
                    'Create or update a workspace aggregate metric written against canonical field names.',
                  readOnly: false,
                },
              ] satisfies ToolSpec[])
            : []),
        ]
      : [];
    for (const spec of [
      ...viewTools,
      ...createTools,
      ...overviewTools,
      ...editTools,
      ...dataSourceTools,
      ...adminTools,
    ]) {
      const registration = document.modelContext.registerTool(
        {
          name: spec.action,
          description: spec.description,
          inputSchema: inputSchemaFor(spec.action, spec.fixed),
          annotations: { readOnlyHint: spec.readOnly },
          execute: async (input) => {
            const request = apiRequestSchema.parse({
              action: spec.action,
              ...spec.fixed,
              ...input,
            });
            options.onToolUse?.(spec.action);
            const result = await callApi(request);
            if (!spec.readOnly) await options.onMutation?.();
            return result;
          },
        },
        { signal: controller.signal },
      );
      void registration.catch((error: unknown) =>
        console.warn('WebMCP tool registration failed', spec.action, error),
      );
    }
    return () => controller.abort();
  }, [
    options.dashboardId,
    options.shareToken,
    options.canCreate,
    options.canEdit,
    options.canManageDataSources,
    options.isAdmin,
    options.onToolUse,
    options.onMutation,
  ]);

  return { available };
}

export function inputSchemaFor(action: ApiRequest['action'], fixed?: Record<string, unknown>) {
  const option = apiRequestSchema.options.find((schema) => schema.shape.action.value === action);
  if (!option) throw new Error(`No API schema exists for ${action}.`);
  const json = z.toJSONSchema(option, {
    target: 'draft-07',
    unrepresentable: 'any',
    reused: 'ref',
  });
  const removed = new Set(['action', ...Object.keys(fixed ?? {})]);
  if (json.properties) for (const key of removed) delete json.properties[key];
  if (json.required) json.required = json.required.filter((key) => !removed.has(key));
  return json as Record<string, unknown>;
}
