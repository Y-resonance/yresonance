import type { Page, Route } from '@playwright/test';
import type { DatasourceDescription } from '#/domain/datasource-fields';
import type { DatasourceCachePolicy, DashboardDocument, DashboardWidget } from '#/domain/schema';

const fixedRange = {
  startDate: { fixed: '2026-08-01' },
  endDate: { fixed: '2026-08-31' },
};

function widget(
  id: string,
  layout: DashboardWidget['layout'],
  definition: DashboardWidget['definition'],
): DashboardWidget {
  return { id, layout, definition, definitionHash: `hash_${id}` };
}

export const dataSourceId = 'src_reporting';

export function buildDashboard(): DashboardDocument {
  return {
    id: 'dash_demo',
    workspaceId: 'ws_demo',
    name: 'Client weekly',
    schemaVersion: 2,
    timezone: 'Europe/Berlin',
    defaultDateRange: fixedRange,
    columns: 12,
    canvasRows: 10,
    createdBy: 'user_demo',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    widgets: [
      widget('w_date', { x: 0, y: 0, width: 4, height: 2 }, { type: 'dateControl' }),
      widget(
        'w_platform',
        { x: 4, y: 0, width: 4, height: 2 },
        {
          type: 'control',
          dataSourceId,
          fieldId: 'f_platform',
          userDefinedName: 'Platform',
          allowMultiple: true,
        },
      ),
      widget(
        'w_spend',
        { x: 0, y: 2, width: 4, height: 3 },
        {
          type: 'scorecard',
          title: 'Media spend',
          dataSourceId,
          dateRangeFieldId: 'f_date',
          metric: {
            source: { kind: 'field', fieldId: 'f_spend', aggregation: 'sum' },
            dataType: 'currency',
          },
        },
      ),
      widget(
        'w_campaigns',
        { x: 4, y: 2, width: 8, height: 5 },
        {
          type: 'table',
          title: 'Campaigns',
          dataSourceId,
          dateRangeFieldId: 'f_date',
          dimensions: [{ fieldId: 'f_campaign' }],
          metrics: [
            {
              source: { kind: 'field', fieldId: 'f_spend', aggregation: 'sum' },
              dataType: 'currency',
            },
          ],
          resultLimit: { mode: 'top', amount: 10 },
        },
      ),
    ],
  };
}

const fields = [
  {
    id: 'f_campaign',
    label: 'Campaign',
    canonicalName: 'campaign',
    role: 'dimension',
    semanticType: 'text',
    columnName: 'Campaign',
  },
  {
    id: 'f_platform',
    label: 'Platform',
    canonicalName: 'platform',
    role: 'dimension',
    semanticType: 'text',
    columnName: 'Platform',
  },
  {
    id: 'f_date',
    label: 'Date start',
    canonicalName: 'date_start',
    role: 'dimension',
    semanticType: 'date',
    columnName: 'DateStart',
  },
  {
    id: 'f_spend',
    label: 'Media cost',
    canonicalName: 'media_cost',
    role: 'metric',
    semanticType: 'currency',
    columnName: 'MediaCost',
    defaultAggregation: 'sum',
  },
  {
    id: 'f_impressions',
    label: 'Impressions',
    canonicalName: 'impressions',
    role: 'metric',
    semanticType: 'count',
    columnName: 'Impressions',
    defaultAggregation: 'sum',
  },
];

const calculatedFields = [
  {
    id: 'calc_vtr',
    canonicalName: 'vtr',
    label: 'VTR',
    expression: 'impressions / 100',
    role: 'metric',
    semanticType: 'ratio',
    defaultAggregation: 'average' as string | null,
    description: null as string | null,
  },
];

const location = { kind: 'object', key: 'ws/demo/report.csv', format: 'csv' } as const;

const description = () => ({
  id: dataSourceId,
  name: 'Reporting example',
  location,
  cachePolicy: { mode: 'default' } as DatasourceCachePolicy,
  fields: fields.map((field) => ({ ...field })),
  calculatedFields: calculatedFields.map((field) => ({ ...field })),
  libraryMetrics: [] as DatasourceDescription['libraryMetrics'],
});

interface MockOptions {
  role?: 'admin' | 'editor' | 'viewer';
  isAdmin?: boolean;
}

/**
 * Serves the signed-in API surface from an in-memory dashboard so mobile and keyboard
 * behaviour can be exercised against the real routes without a Clerk session.
 */
export async function mockYresonanceApi(page: Page, options: MockOptions = {}) {
  const state = {
    dashboard: buildDashboard(),
    source: description(),
    nextWidget: 0,
    duplicateRequests: [] as unknown[],
  };
  const ok = (route: Route, data: unknown) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data }),
    });

  await page.route('**/api/yresonance', async (route) => {
    const request = route.request().postDataJSON() as Record<string, string> & {
      cachePolicy?: DatasourceCachePolicy;
      definition?: DashboardWidget['definition'];
      width?: number;
      height?: number;
      placements?: Array<{ widgetId: string; placement: DashboardWidget['layout'] }>;
      canvasRows?: number;
      patch?: Record<string, unknown>;
      libraryMetric?: {
        name: string;
        expression: string;
        semanticType: 'count';
      };
    };
    switch (request.action) {
      case 'bootstrap':
        return ok(route, {
          workspace: { id: 'ws_demo', name: 'Demo workspace' },
          isAdmin: options.isAdmin ?? true,
          dashboards: [
            {
              id: state.dashboard.id,
              name: state.dashboard.name,
              canEdit: (options.role ?? 'editor') !== 'viewer',
              dataSourceIds: [dataSourceId],
              updatedAt: state.dashboard.updatedAt,
            },
          ],
          dataSources: [
            { id: dataSourceId, name: state.source.name },
            { id: 'src_client_b', name: 'Client B reporting' },
          ],
        });
      case 'listDashboards':
        return ok(route, [{ id: state.dashboard.id, name: state.dashboard.name }]);
      case 'getDashboard':
        return ok(route, {
          dashboard: state.dashboard,
          role: options.role ?? 'editor',
          dataSources: [{ id: dataSourceId, name: state.source.name }],
          sharing: { links: [], grants: [] },
        });
      case 'listDataSources':
        return ok(route, [
          {
            id: dataSourceId,
            name: state.source.name,
            location,
            fieldCount: state.source.fields.length,
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ]);
      case 'describeDatasource':
        return ok(route, state.source);
      case 'updateDatasource':
        state.source.cachePolicy = request.cachePolicy!;
        return ok(route, state.source);
      case 'getSharedDashboard':
        return ok(route, { dashboard: state.dashboard });
      case 'updateFieldMetadata':
        state.source = {
          ...state.source,
          fields: state.source.fields.map((field) =>
            field.columnName === request.columnName ? { ...field, ...request.patch } : field,
          ),
        };
        return ok(route, { ok: true });
      // The dialogs compile formulas locally too, so a permissive stub still exercises the rules.
      case 'validateCalculatedField':
      case 'validateMetricExpression':
        return ok(route, { valid: true, type: 'number', identifiers: ['impressions'] });
      case 'upsertCalculatedField': {
        const existing = state.source.calculatedFields.find((field) => field.id === request.id);
        const persisted = {
          id: existing?.id ?? `calc_${Date.now()}`,
          canonicalName:
            existing?.canonicalName ??
            request.canonicalName ??
            request.name.toLowerCase().replaceAll(' ', '_'),
          label: request.name,
          expression: request.expression,
          role: request.role,
          semanticType: request.semanticType,
          defaultAggregation: request.defaultAggregation ?? null,
          description: request.description ?? null,
        };
        state.source = {
          ...state.source,
          calculatedFields: existing
            ? state.source.calculatedFields.map((field) =>
                field.id === existing.id ? persisted : field,
              )
            : [...state.source.calculatedFields, persisted],
        };
        return ok(route, persisted);
      }
      case 'getControlOptions':
        return ok(route, { values: ['FB', 'IG', 'TikTok'] });
      case 'queryWidget':
        return ok(route, {
          rows: [
            { dimension_1: 'Spring sale', metric_1: 1234.5 },
            { dimension_1: 'Always on', metric_1: 987.25 },
          ],
          columns: [
            { key: 'dimension_1', label: 'Campaign', kind: 'dimension', dataType: 'text' },
            { key: 'metric_1', label: 'Media cost', kind: 'metric', dataType: 'currency' },
          ],
          hasMore: false,
        });
      case 'addWidget': {
        state.nextWidget += 1;
        const added = widget(
          `w_added_${state.nextWidget}`,
          { x: 0, y: 20, width: request.width ?? 4, height: request.height ?? 3 },
          request.definition!,
        );
        state.dashboard = {
          ...state.dashboard,
          widgets: [...state.dashboard.widgets, added],
          canvasRows: Math.max(
            state.dashboard.canvasRows,
            added.layout.y + added.layout.height + 2,
          ),
        };
        return ok(route, { widget: added });
      }
      case 'updateWidget': {
        state.dashboard = {
          ...state.dashboard,
          widgets: state.dashboard.widgets.map((item) =>
            item.id === request.widgetId
              ? { ...item, definition: request.definition!, definitionHash: `hash_${Date.now()}` }
              : item,
          ),
        };
        if (request.libraryMetric) {
          state.source = {
            ...state.source,
            libraryMetrics: [
              ...state.source.libraryMetrics,
              {
                id: `metric_${Date.now()}`,
                canonicalName: request.libraryMetric.name.toLowerCase().replaceAll(' ', '_'),
                description: null,
                ...request.libraryMetric,
              },
            ],
          };
        }
        return ok(route, {
          widget: state.dashboard.widgets.find((i) => i.id === request.widgetId),
        });
      }
      case 'updateLayout': {
        const byId = new Map(
          (request.placements ?? []).map((entry) => [entry.widgetId, entry.placement]),
        );
        state.dashboard = {
          ...state.dashboard,
          canvasRows: request.canvasRows ?? state.dashboard.canvasRows,
          widgets: state.dashboard.widgets.map((item) =>
            byId.has(item.id) ? { ...item, layout: byId.get(item.id)! } : item,
          ),
        };
        return ok(route, { ok: true });
      }
      case 'removeWidget':
        state.dashboard = {
          ...state.dashboard,
          widgets: state.dashboard.widgets.filter((item) => item.id !== request.widgetId),
        };
        return ok(route, { ok: true });
      case 'duplicateDashboard':
        state.duplicateRequests.push(request);
        return ok(route, { ...state.dashboard, id: 'dash_copy', name: request.name });
      case 'listLibraryMetrics':
        return ok(route, []);
      case 'listR2Objects':
        return ok(route, { objects: [] });
      // A blanket success would let a test pass against an action the mock never
      // implemented. Failing loudly points at the missing case instead.
      default:
        return route.fulfill({
          status: 501,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: {
              code: 'mock_action_not_implemented',
              message: `The yresonance API mock does not implement ${request.action}.`,
            },
          }),
        });
    }
  });

  return state;
}
