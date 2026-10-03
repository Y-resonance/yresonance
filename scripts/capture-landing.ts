/**
 * Rebuilds the landing page screenshots against a local dev server.
 *
 * It signs in to the Clerk development instance with a sign-in token, uploads the generated demo
 * export, builds a dashboard that uses the widget types the product actually ships, shares it, and
 * captures the shared view plus the field metadata screen, each in the light and the dark theme.
 *
 *   bun run dev                     # in another shell, or set YRESONANCE_BASE_URL
 *   bun run scripts/capture-landing.ts
 *
 * Every run creates a fresh datasource and dashboard in the local workspace; the local D1 file is
 * scratch state, so nothing cleans up after it.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { exampleCampaignCsv } from '../src/data/example-campaign.ts';

const baseUrl = process.env.YRESONANCE_BASE_URL ?? 'http://localhost:3140';
const userEmail = process.env.LANDING_USER_EMAIL;
const organizationName = process.env.LANDING_ORG_NAME ?? 'Acme Media';
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const outputDirectory = 'public/landing';

const viewport = { width: 1440, height: 1000 };
const themes = ['light', 'dark'] as const;
type Theme = (typeof themes)[number];
const deviceScaleFactor = 2;
const dashboardName = 'Acme Media, Q1 delivery';
const datasourceName = 'Campaign delivery';
const dateRange = { startDate: { fixed: '2026-01-01' }, endDate: { fixed: '2026-03-31' } };

interface Field {
  id: string;
  columnName: string;
  canonicalName: string;
}

if (!userEmail) throw new Error('LANDING_USER_EMAIL is required for an existing Clerk test user.');
if (!clerkSecretKey) throw new Error('CLERK_SECRET_KEY is required to mint a sign-in token.');

const browser = await chromium.launch();
try {
  await capture(browser);
} finally {
  await browser.close();
}

async function capture(browser: Browser) {
  // The landing page is English, so the screenshots must not pick up the runner's locale.
  const context = await browser.newContext({ viewport, deviceScaleFactor, locale: 'en-US' });
  const page = await context.newPage();
  await signIn(page);

  const source = await registerDemoDatasource(page);
  const field = (columnName: string) => {
    const found = source.fields.find((entry) => entry.columnName === columnName);
    if (!found) throw new Error(`The demo export has no "${columnName}" column.`);
    return found;
  };
  await describeFields(page, source.id);

  const clickThroughRate = await libraryMetric(page, {
    name: 'Click-through rate',
    expression: `sum(${field('Clicks').canonicalName}) / nullif(sum(${field('Impressions').canonicalName}), 0)`,
    semanticType: 'ratio',
    description: 'Clicks divided by impressions, defined once and reused by every dashboard.',
  });

  const dashboard = await buildDashboard(page, source.id, field, clickThroughRate);
  const share = await callApi<{ token: string }>(page, {
    action: 'shareDashboard',
    dashboardId: dashboard,
    operation: { kind: 'createLink' },
  });

  await mkdir(outputDirectory, { recursive: true });
  for (const theme of themes) {
    await useTheme(page, theme);
    await captureDashboard(page, share.token, theme);
    await captureFieldMetadata(page, source.id, theme);
  }
  await context.close();
}

/**
 * A backend sign-in token stands in for a password this script does not hold. Ticket sign-ins skip
 * the bot protection a development instance would otherwise ask an unrecognised browser to pass.
 */
async function signIn(page: Page) {
  const users = await clerkApi<Array<{ id: string }>>(
    `/users?email_address=${encodeURIComponent(userEmail)}&limit=1`,
  );
  const userId = users[0]?.id;
  if (!userId) throw new Error(`The Clerk instance has no user with the address ${userEmail}.`);
  const organizations = await clerkApi<{ data: Array<{ id: string; name: string }> }>(
    `/organizations?query=${encodeURIComponent(organizationName)}&limit=10`,
  );
  const organizationId = organizations.data.find(
    (organization) => organization.name === organizationName,
  )?.id;
  if (!organizationId)
    throw new Error(`The Clerk instance has no organization named ${organizationName}.`);
  const ticket = await clerkApi<{ token: string }>('/sign_in_tokens', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 600 }),
  });

  await page.goto(baseUrl);
  await page.waitForFunction(() => Boolean(window.Clerk?.loaded), undefined, { timeout: 60_000 });
  const status = await page.evaluate(
    async ([token, organization]) => {
      const client = window.Clerk.client;
      if (!client) return 'the Clerk client never became available';
      const attempt = await client.signIn.create({ strategy: 'ticket', ticket: token });
      if (attempt.status !== 'complete' || !attempt.createdSessionId) return attempt.status;
      await window.Clerk.setActive({ session: attempt.createdSessionId, organization });
      return 'complete';
    },
    [ticket.token, organizationId] as const,
  );
  if (status !== 'complete') throw new Error(`Clerk stopped the sign-in at "${status}".`);
  await callApi(page, { action: 'bootstrap' });
}

/**
 * Datasource names are unique per workspace and the generated export is deterministic, so a repeat
 * run reuses the registered source. Edit the generator and the local environment needs a reset
 * (`bun run reset development`) before the new columns show up.
 */
async function registerDemoDatasource(page: Page) {
  const sources = await callApi<Array<{ id: string; name: string }>>(page, {
    action: 'listDataSources',
  });
  const existing = sources.find((source) => source.name === datasourceName);
  if (existing)
    return callApi<{ id: string; fields: Field[] }>(page, {
      action: 'describeDatasource',
      dataSourceId: existing.id,
    });

  const contents = Buffer.from(exampleCampaignCsv(), 'utf8');
  const upload = await callApi<{ key: string; uploadUrl: string; cleanupToken: string }>(page, {
    action: 'prepareDatasourceUpload',
    fileName: 'campaign_delivery.csv',
    fileSize: contents.byteLength,
    format: 'csv',
  });
  const stored = await page.request.put(upload.uploadUrl, {
    data: contents,
    headers: { 'content-type': 'text/csv' },
  });
  if (!stored.ok()) throw new Error(`Uploading the demo export failed with ${stored.status()}.`);
  return callApi<{ id: string; fields: Field[] }>(page, {
    action: 'registerDatasource',
    name: datasourceName,
    location: { kind: 'object', key: upload.key, format: 'csv' },
    cleanupToken: upload.cleanupToken,
  });
}

/** Updates the workspace metric of that name when a previous run already defined it. */
async function libraryMetric(page: Page, metric: Record<string, unknown>) {
  const existing = await callApi<Array<{ id: string; name: string }>>(page, {
    action: 'listLibraryMetrics',
  });
  const id = existing.find((candidate) => candidate.name === metric.name)?.id;
  const saved = await callApi<{ id: string }>(page, {
    action: 'upsertLibraryMetric',
    ...metric,
    ...(id ? { id } : {}),
  });
  return saved.id;
}

/** Corrects the handful of fields whose inferred metadata would read wrong on a client report. */
async function describeFields(page: Page, dataSourceId: string) {
  const patches: Array<[string, Record<string, unknown>]> = [
    ['Date', { description: 'Delivery day in the reporting timezone.' }],
    ['Campaign', { description: 'Booking name as it appears on the invoice.' }],
    ['Market', { description: 'Country the line item was bought for.' }],
    ['Platform', { description: 'Buying platform the line item ran on.' }],
    ['AdFormat', { description: 'Creative format as booked, not as delivered.' }],
    ['Targeting', { description: 'Audience strategy the line item ran on.' }],
    ['Impressions', { description: 'Served impressions after platform deduplication.' }],
    ['VideoCompletions', { label: 'Video completions', description: 'Views reaching 100%.' }],
    ['Conversions', { description: 'Post-click conversions inside a 7 day window.' }],
    [
      'MediaSpend',
      { semanticType: 'currency', label: 'Media spend', description: 'Net media cost in EUR.' },
    ],
  ];
  for (const [columnName, patch] of patches)
    await callApi(page, { action: 'updateFieldMetadata', dataSourceId, columnName, patch });

  // One calculated field, so the screen shows a formula sitting next to the registered columns.
  // A repeat run reuses the datasource, so the field has to be updated instead of inserted again.
  const described = await callApi<{ calculatedFields: Array<{ id: string; label: string }> }>(
    page,
    {
      action: 'describeDatasource',
      dataSourceId,
    },
  );
  const calculatedFieldId = described.calculatedFields.find(
    (entry) => entry.label === 'Effective CPM',
  )?.id;
  await callApi(page, {
    action: 'upsertCalculatedField',
    dataSourceId,
    ...(calculatedFieldId ? { id: calculatedFieldId } : {}),
    name: 'Effective CPM',
    expression: 'media_spend / nullif(impressions, 0) * 1000',
    role: 'metric',
    semanticType: 'currency',
    defaultAggregation: 'average',
    description: 'Cost per thousand impressions, derived per row.',
  });
}

async function buildDashboard(
  page: Page,
  dataSourceId: string,
  field: (columnName: string) => Field,
  libraryMetricId: string,
) {
  const dashboard = await callApi<{ id: string }>(page, {
    action: 'createDashboard',
    name: dashboardName,
    dataSourceIds: [dataSourceId],
    timezone: 'Europe/Berlin',
    defaultDateRange: dateRange,
  });
  const dateRangeFieldId = field('Date').id;
  const card = { dataSourceId, dateRangeFieldId };
  const sum = (columnName: string, dataType: string) => ({
    source: { kind: 'field', fieldId: field(columnName).id, aggregation: 'sum' },
    dataType,
  });

  const placements: Array<{ widgetId: string; placement: Placement }> = [];
  const add = async (definition: Record<string, unknown>, placement: Placement) => {
    const { widget } = await callApi<{ widget: { id: string } }>(page, {
      action: 'addWidget',
      dashboardId: dashboard.id,
      definition,
      width: placement.width,
      height: placement.height,
    });
    placements.push({ widgetId: widget.id, placement });
  };

  await add({ type: 'dateControl', defaultDateRange: dateRange }, at(0, 0, 4, 1));
  for (const [index, [columnName, label]] of (
    [
      ['Market', 'Market'],
      ['Platform', 'Platform'],
    ] as const
  ).entries())
    await add(
      {
        type: 'control',
        dataSourceId,
        fieldId: field(columnName).id,
        userDefinedName: label,
        allowMultiple: true,
        optionsSortDirection: 'asc',
      },
      at(4 + index * 4, 0, 4, 1),
    );

  await add(
    {
      ...card,
      type: 'scorecard',
      title: 'Impressions',
      metric: sum('Impressions', 'number'),
      comparison: { mode: 'previousPeriod' },
    },
    at(0, 1, 3, 2),
  );
  await add(
    {
      ...card,
      type: 'scorecard',
      title: 'Clicks',
      metric: sum('Clicks', 'number'),
      comparison: { mode: 'previousPeriod' },
    },
    at(3, 1, 3, 2),
  );
  await add(
    {
      ...card,
      type: 'scorecard',
      title: 'Media spend',
      metric: sum('MediaSpend', 'currency'),
      comparison: { mode: 'previousPeriod' },
    },
    at(6, 1, 3, 2),
  );
  await add(
    {
      ...card,
      type: 'scorecard',
      title: 'Click-through rate',
      metric: {
        source: { kind: 'library', libraryMetricId },
        dataType: 'percent',
        displayFormat: { radix: 2 },
        conditionalFormat: [{ comparator: 'gte', value: 0.004, color: 'positive' }],
      },
    },
    at(9, 1, 3, 2),
  );

  // Volume and rate move independently, so the second axis earns its place instead of tracing
  // the first line.
  await add(
    {
      ...card,
      type: 'line',
      title: 'Impressions and click-through rate',
      dimension: { fieldId: dateRangeFieldId, dateGranularity: 'day' },
      metrics: [
        sum('Impressions', 'number'),
        {
          source: { kind: 'library', libraryMetricId },
          dataType: 'percent',
          displayFormat: { radix: 2 },
        },
      ],
    },
    at(0, 3, 8, 6),
  );
  await add(
    {
      ...card,
      type: 'gauge',
      title: 'Media spend against plan',
      metric: sum('MediaSpend', 'currency'),
      upperLimit: { kind: 'manual', value: 260_000 },
    },
    at(8, 3, 4, 3),
  );
  await add(
    {
      type: 'text',
      content: {
        schemaVersion: '1',
        document:
          'Easter week carried the quarter. Spend stays inside the plan, so the remaining budget ' +
          'moves to TikTok video in April.',
      },
    },
    at(8, 6, 4, 3),
  );

  await add(
    {
      ...card,
      type: 'bar',
      title: 'Impressions by campaign and format',
      metric: sum('Impressions', 'number'),
      dimension: { fieldId: field('Campaign').id },
      breakdownDimension: { fieldId: field('AdFormat').id },
      sort: [{ target: { kind: 'metric', index: 0 }, direction: 'desc' }],
      limit: 24,
    },
    at(0, 9, 8, 6),
  );
  await add(
    {
      ...card,
      type: 'pie',
      title: 'Spend share by platform',
      metric: sum('MediaSpend', 'currency'),
      dimension: { fieldId: field('Platform').id },
      sort: [{ target: { kind: 'metric', index: 0 }, direction: 'desc' }],
    },
    at(8, 9, 4, 6),
  );

  await add(
    {
      ...card,
      type: 'table',
      title: 'Campaign breakdown by platform',
      dimensions: [{ fieldId: field('Campaign').id }],
      pivotDimension: { fieldId: field('Platform').id },
      metrics: [sum('Impressions', 'number'), sum('MediaSpend', 'currency')],
      resultLimit: { mode: 'top', amount: 60 },
      showSummaryRow: true,
      sort: [{ target: { kind: 'metric', index: 0 }, direction: 'desc' }],
    },
    at(0, 15, 12, 5),
  );

  await callApi(page, {
    action: 'updateLayout',
    dashboardId: dashboard.id,
    canvasRows: 22,
    placements,
  });
  return dashboard.id;
}

/**
 * The hero shows the controls, headline numbers and trend; the second image picks up where it
 * stops, so the two read as one dashboard scrolled down rather than two unrelated products.
 */
async function captureDashboard(page: Page, shareToken: string, theme: Theme) {
  await page.goto(`${baseUrl}/share/${shareToken}`);
  await settle(page);
  const split = await topOf(page, 'Impressions by campaign and format');
  const end = await bottomOf(page, 'Campaign breakdown by platform');
  await page.screenshot({
    path: imagePath('dashboard', theme),
    fullPage: true,
    clip: { x: 0, y: 0, width: viewport.width, height: split - 8 },
  });
  await page.screenshot({
    path: imagePath('dashboard-breakdown', theme),
    fullPage: true,
    clip: { x: 0, y: split - 8, width: viewport.width, height: end + 24 - (split - 8) },
  });
}

async function captureFieldMetadata(page: Page, dataSourceId: string, theme: Theme) {
  await page.goto(`${baseUrl}/datasources/${dataSourceId}`);
  await settle(page);
  // Cutting on the last field row keeps the image from ending inside a half-rendered one.
  const lastRow = await page
    .getByRole('row', { name: /Effective CPM/ })
    .first()
    .boundingBox();
  if (!lastRow) throw new Error('The calculated field row never rendered.');
  await page.screenshot({
    path: imagePath('field-metadata', theme),
    fullPage: true,
    clip: { x: 0, y: 0, width: viewport.width, height: lastRow.y + lastRow.height },
  });
}

/**
 * The app reads the stored theme before first paint, so writing it and navigating afterwards gives
 * a genuine dark render: chart colours are read at render time and would keep their light values
 * if the class were only toggled on an already painted page.
 */
async function useTheme(page: Page, theme: Theme) {
  await page.goto(baseUrl);
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
}

/** The landing page pairs each image with its dark twin, named after the light one. */
function imagePath(name: string, theme: Theme) {
  return `${outputDirectory}/${name}${theme === 'dark' ? '-dark' : ''}.png`;
}

/** Waits for every widget to have finished querying, then lets the chart animations land. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-slot="skeleton"]').length === 0,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2_000);
}

async function topOf(page: Page, title: string) {
  const box = await cardBox(page, title);
  return box.y;
}

async function bottomOf(page: Page, title: string) {
  const box = await cardBox(page, title);
  return box.y + box.height;
}

async function cardBox(page: Page, title: string) {
  const card = page.locator('[data-slot="card"]').filter({ hasText: title }).first();
  const box = await card.boundingBox();
  if (!box) throw new Error(`The "${title}" widget never rendered.`);
  return box;
}

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

function at(x: number, y: number, width: number, height: number): Placement {
  return { x, y, width, height };
}

async function callApi<T>(page: Page, body: Record<string, unknown>): Promise<T> {
  const response = await page.request.post(`${baseUrl}/api/yresonance`, { data: body });
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: unknown;
    error?: { code: string; message: string };
  };
  if (!envelope.ok)
    throw new Error(
      `${String(body.action)} failed with ${envelope.error?.code}: ${envelope.error?.message}`,
    );
  return envelope.data as T;
}

async function clerkApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${clerkSecretKey!}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok)
    throw new Error(`Clerk ${path} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}
