import { type ApiRequest } from '#/api/contracts';
import { ApiError } from './errors';
import { recordProductMetric } from '#/observability';
import {
  addPage,
  updatePage,
  removePage,
  pageById,
  bootstrap,
  listDashboards,
  getDashboard,
  getSharedDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  duplicateDashboard,
  addWidget,
  updateWidget,
  removeWidget,
  moveWidget,
  updateLayout,
  copyWidget,
} from './dashboards.server';
import {
  previewWidget,
  queryWidget,
  explainWidget,
  getControlOptions,
} from './widget-queries.server';
import {
  listDataSources,
  describeDatasource,
  listR2Objects,
  prepareDatasourceUpload,
  removeDatasourceUpload,
  trackDatasourceUpload,
  registerDatasource,
  updateDatasource,
  updateFieldMetadata,
} from './datasources.server';
import {
  listLibraryMetrics,
  upsertCalculatedField,
  validateCalculatedField,
  previewCalculatedFieldValues,
  validateMetricExpression,
  upsertLibraryMetric,
} from './formulas.server';
import { authorizeDashboard } from './dashboard-access.server';
import { shareDashboard } from './sharing.server';

export async function executeRequest(request: ApiRequest): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const result = await dispatchRequest(request);
    console.info('yresonance.request', {
      action: request.action,
      result: 'success',
      durationMs: Date.now() - startedAt,
      ...safeRequestIdentifiers(request),
    });
    recordLatency(request.action, 'success', Date.now() - startedAt);
    return result;
  } catch (error) {
    console.warn('yresonance.request', {
      action: request.action,
      result: 'error',
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof ApiError ? error.code : 'unexpected_error',
      ...safeRequestIdentifiers(request),
    });
    recordLatency(request.action, 'error', Date.now() - startedAt);
    throw error;
  }
}

async function dispatchRequest(request: ApiRequest): Promise<unknown> {
  switch (request.action) {
    case 'addPage':
      return addPage(request);
    case 'updatePage':
      return updatePage(request);
    case 'removePage':
      return removePage(request);
    case 'trackPageView': {
      const access = await authorizeDashboard(request.dashboardId, 'viewer', request.shareToken);
      const page = pageById(access.document, request.pageId);
      recordProductMetric('dashboard_page_view', {
        index: access.document.workspaceId,
        labels: [access.document.id, page.id, access.role],
      });
      return { pageId: page.id };
    }
    case 'bootstrap':
      return bootstrap();
    case 'listDashboards':
      return listDashboards();
    case 'getDashboard':
      return getDashboard(request.dashboardId, request.shareToken);
    case 'getSharedDashboard':
      return getSharedDashboard(request.shareToken);
    case 'createDashboard':
      return createDashboard(request);
    case 'updateDashboard':
      return updateDashboard(request);
    case 'deleteDashboard':
      return deleteDashboard(request.dashboardId);
    case 'duplicateDashboard':
      return duplicateDashboard(request);
    case 'addWidget':
      return addWidget(request);
    case 'updateWidget':
      return updateWidget(request);
    case 'removeWidget':
      return removeWidget(request);
    case 'moveWidget':
      return moveWidget(request);
    case 'updateLayout':
      return updateLayout(request);
    case 'copyWidget':
      return copyWidget(request);
    case 'previewWidget':
      return previewWidget(request);
    case 'queryWidget':
      return queryWidget(
        request.dashboardId,
        request.widgetId,
        request.controlState,
        request.shareToken,
        request.page,
        request.refresh,
        request.drillPath,
      );
    case 'explainWidget':
      return explainWidget(request.dashboardId, request.widgetId, request.shareToken);
    case 'getControlOptions':
      return getControlOptions(
        request.dashboardId,
        request.controlId,
        request.search,
        request.shareToken,
      );
    case 'listDataSources':
      return listDataSources();
    case 'listLibraryMetrics':
      return listLibraryMetrics();
    case 'describeDatasource':
      return describeDatasource(request.dataSourceId, request.dashboardId, request.shareToken);
    case 'listR2Objects':
      return listR2Objects(request.prefix, request.cursor);
    case 'prepareDatasourceUpload':
      return prepareDatasourceUpload(request);
    case 'removeDatasourceUpload':
      return removeDatasourceUpload(request);
    case 'trackDatasourceUpload':
      return trackDatasourceUpload(request);
    case 'updateDatasource':
      return updateDatasource(request);
    case 'registerDatasource':
      return registerDatasource(request);
    case 'updateFieldMetadata':
      return updateFieldMetadata(request);
    case 'upsertCalculatedField':
      return upsertCalculatedField(request);
    case 'validateCalculatedField':
      return validateCalculatedField(request);
    case 'previewCalculatedFieldValues':
      return previewCalculatedFieldValues(request);
    case 'validateMetricExpression':
      return validateMetricExpression(request);
    case 'upsertLibraryMetric':
      return upsertLibraryMetric(request);
    case 'shareDashboard':
      return shareDashboard(request);
  }
}

function recordLatency(
  action: ApiRequest['action'],
  result: 'success' | 'error',
  durationMs: number,
) {
  const event = dashboardSaveActions.has(action)
    ? 'dashboard_save'
    : action === 'previewWidget'
      ? 'dashboard_preview'
      : action === 'queryWidget'
        ? 'widget_query'
        : undefined;
  if (!event) return;
  console.info(`yresonance.${event}`, { action, result, durationMs });
  recordProductMetric(event, { labels: [action, result], numbers: [durationMs] });
}

const dashboardSaveActions = new Set<ApiRequest['action']>([
  'addPage',
  'updatePage',
  'removePage',
  'createDashboard',
  'updateDashboard',
  'duplicateDashboard',
  'addWidget',
  'updateWidget',
  'removeWidget',
  'moveWidget',
  'updateLayout',
  'copyWidget',
]);

function safeRequestIdentifiers(request: ApiRequest) {
  return {
    ...('dashboardId' in request ? { dashboardId: request.dashboardId } : {}),
    ...('widgetId' in request ? { widgetId: request.widgetId } : {}),
    ...('dataSourceId' in request ? { dataSourceId: request.dataSourceId } : {}),
  };
}

export { validateControlState } from './widget-queries.server';
