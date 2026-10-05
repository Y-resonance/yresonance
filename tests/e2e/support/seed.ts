import { expect, type Page } from '@playwright/test';

interface ApiEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface SeededField {
  id: string;
  columnName: string;
  role: string;
  semanticType: string;
}

export interface SeededDataSource {
  id: string;
  name: string;
  fields: SeededField[];
}

const reportCsv = [
  'region,Date,revenue,impressions',
  'north,Mon Jan 05 2026 00:00:00 GMT+0100 (Central European Standard Time),120,12340',
  'south,Tue Jan 06 2026 00:00:00 GMT+0100 (Central European Standard Time),80,9870',
  'north,Wed Jan 07 2026 00:00:00 GMT+0100 (Central European Standard Time),200,15210',
  'south,Thu Jan 08 2026 00:00:00 GMT+0100 (Central European Standard Time),45,7080',
  '',
].join('\n');

/** Calls the API with the signed-in browser context, so tenancy is resolved the real way. */
export async function callApi<T>(page: Page, body: Record<string, unknown>): Promise<T> {
  const response = await page.request.post('/api/yresonance', { data: body });
  const envelope = (await response.json()) as ApiEnvelope;
  if (!envelope.ok)
    throw new Error(
      `${String(body.action)} failed with ${envelope.error?.code}: ${envelope.error?.message}`,
    );
  return envelope.data as T;
}

/** Uploads a small CSV through the real upload path and registers it as a datasource. */
export async function seedDataSource(page: Page, name: string): Promise<SeededDataSource> {
  const contents = Buffer.from(reportCsv, 'utf8');
  const upload = await callApi<{ key: string; uploadUrl: string; cleanupToken: string }>(page, {
    action: 'prepareDatasourceUpload',
    fileName: `${name}.csv`,
    fileSize: contents.byteLength,
    format: 'csv',
  });
  const stored = await page.request.put(upload.uploadUrl, {
    data: contents,
    headers: { 'content-type': 'text/csv' },
  });
  expect(stored.ok(), `uploading ${upload.key} failed with HTTP ${stored.status()}`).toBe(true);

  return callApi<SeededDataSource>(page, {
    action: 'registerDatasource',
    name,
    location: { kind: 'object', key: upload.key, format: 'csv' },
    cleanupToken: upload.cleanupToken,
  });
}

export function fieldId(source: SeededDataSource, columnName: string) {
  const field = source.fields.find((entry) => entry.columnName === columnName);
  if (!field) throw new Error(`Seeded datasource has no "${columnName}" column.`);
  return field.id;
}

/** Creates a dashboard with a scorecard and a filter control over the seeded datasource. */
export async function seedDashboard(page: Page, name: string, source: SeededDataSource) {
  const dashboard = await callApi<{ id: string }>(page, {
    action: 'createDashboard',
    name,
    dataSourceIds: [source.id],
    timezone: 'Europe/Berlin',
    defaultDateRange: { startDate: { fixed: '2026-01-01' }, endDate: { fixed: '2026-01-31' } },
  });
  await callApi(page, {
    action: 'addWidget',
    pageId: `${dashboard.id}_page`,
    dashboardId: dashboard.id,
    definition: {
      type: 'scorecard',
      title: 'Revenue',
      dataSourceId: source.id,
      dateRangeFieldId: fieldId(source, 'Date'),
      metric: {
        source: { kind: 'field', fieldId: fieldId(source, 'revenue'), aggregation: 'sum' },
        dataType: 'number',
      },
    },
    width: 4,
    height: 3,
  });
  await callApi(page, {
    action: 'addWidget',
    pageId: `${dashboard.id}_page`,
    dashboardId: dashboard.id,
    definition: {
      type: 'control',
      dataSourceId: source.id,
      fieldId: fieldId(source, 'region'),
      userDefinedName: 'Region',
      allowMultiple: true,
    },
    width: 4,
    height: 2,
  });
  return dashboard;
}

/** Creates a date-controlled impressions scorecard and time series over the uploaded CSV. */
export async function seedImpressionsDashboard(page: Page, name: string, source: SeededDataSource) {
  const dashboard = await callApi<{ id: string }>(page, {
    action: 'createDashboard',
    name,
    dataSourceIds: [source.id],
    timezone: 'Europe/Berlin',
    defaultDateRange: { startDate: { fixed: '2026-01-01' }, endDate: { fixed: '2026-01-31' } },
  });
  const metric = {
    source: {
      kind: 'field' as const,
      fieldId: fieldId(source, 'impressions'),
      aggregation: 'sum' as const,
    },
    dataType: 'number' as const,
  };
  await callApi(page, {
    action: 'addWidget',
    pageId: `${dashboard.id}_page`,
    dashboardId: dashboard.id,
    definition: {
      type: 'scorecard',
      title: 'Impressions',
      dataSourceId: source.id,
      dateRangeFieldId: fieldId(source, 'Date'),
      metric,
    },
    width: 4,
    height: 3,
  });
  await callApi(page, {
    action: 'addWidget',
    pageId: `${dashboard.id}_page`,
    dashboardId: dashboard.id,
    definition: {
      type: 'line',
      title: 'Impressions over time',
      dataSourceId: source.id,
      dateRangeFieldId: fieldId(source, 'Date'),
      dimension: { fieldId: fieldId(source, 'Date') },
      metrics: [metric],
    },
    width: 8,
    height: 5,
  });
  await callApi(page, {
    action: 'addWidget',
    pageId: `${dashboard.id}_page`,
    dashboardId: dashboard.id,
    definition: { type: 'dateControl' },
    width: 4,
    height: 2,
  });
  return dashboard;
}
