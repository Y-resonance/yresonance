import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import { apiRequestSchema } from '#/api/contracts';
import { createDatabase } from '#/db/client';
import { dataSources, fields } from '#/db/schema';
import type { SourceListing } from '#/data/source.server';
import type { WidgetDefinition } from '#/domain/schema';
import { Route as apiRoute } from '#/routes/api.yresonance';
import { ApiError } from '#/server/errors';
import { executeRequest } from '#/server/service.server';
import { signInAs } from './doubles/clerk';

let sequence = 0;
const uniqueId = (prefix: string) =>
  `${prefix}_${(sequence += 1)}_${crypto.randomUUID().slice(0, 8)}`;

export type { SourceListing };

export interface TestWorkspace {
  userId: string;
  orgId: string;
  workspaceId: string;
  r2Prefix: string;
}

export interface SeededDataSource {
  id: string;
  name: string;
  version: string;
  fieldIds: { region: string; revenue: string; day: string };
}

/** Runs a request through the same schema the API route parses, so defaults apply. */
export function callService(request: unknown) {
  return executeRequest(apiRequestSchema.parse(request));
}

/** Posts to the real `/api/yresonance` handler to exercise the HTTP envelope. */
export function postApiRequest(body: unknown) {
  const handlers = apiRoute.options.server?.handlers;
  if (!handlers || typeof handlers !== 'object' || !('POST' in handlers))
    throw new Error('The /api/yresonance route no longer exposes a POST handler.');
  const post = (handlers as { POST: (context: { request: Request }) => Promise<Response> }).POST;
  return post({
    request: new Request('https://yresonance.test/api/yresonance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

/** Signs a fresh Clerk identity in and bootstraps its workspace through the real service. */
export async function signInToNewWorkspace({ isAdmin = true } = {}): Promise<TestWorkspace> {
  const orgId = uniqueId('org');
  const userId = uniqueId('user');
  signInAs({ userId, orgId, orgSlug: orgId, isAdmin });
  const { workspace } = (await callService({ action: 'bootstrap' })) as {
    workspace: { id: string };
  };
  return { userId, orgId, workspaceId: workspace.id, r2Prefix: `ws/${workspace.id}/` };
}

/** Mints a Clerk user id without signing anyone in. */
export function newUserId() {
  return uniqueId('user');
}

/** Signs a specific member of the workspace's Clerk organization in. */
export function signInAsUser(workspace: TestWorkspace, userId: string, { isAdmin = false } = {}) {
  signInAs({ userId, orgId: workspace.orgId, orgSlug: workspace.orgId, isAdmin });
  return userId;
}

/** Signs a fresh non-admin member of the same Clerk organization in. */
export function signInAsColleague(workspace: TestWorkspace) {
  return signInAsUser(workspace, newUserId());
}

/** Signs the workspace owner back in. */
export function signInAsOwner(workspace: TestWorkspace, { isAdmin = true } = {}) {
  signInAsUser(workspace, workspace.userId, { isAdmin });
}

/**
 * Writes a datasource and its fields straight to D1. Registration goes through object
 * storage, which these tests substitute rather than protect.
 */
export async function seedDataSource(
  workspace: TestWorkspace,
  { version = 'source-v1' } = {},
): Promise<SeededDataSource> {
  const database = createDatabase(env.DB);
  const id = uniqueId('ds');
  const name = uniqueId('Sales');
  const now = new Date().toISOString();
  await database.insert(dataSources).values({
    id,
    workspaceId: workspace.workspaceId,
    name,
    location: { kind: 'object', key: `${workspace.r2Prefix}${name}.csv`, format: 'csv' },
    version,
    createdAt: now,
    updatedAt: now,
  });
  const columns = [
    {
      columnName: 'region',
      canonicalName: 'region',
      label: 'Region',
      role: 'dimension',
      semanticType: 'text',
      defaultAggregation: null,
    },
    {
      columnName: 'revenue',
      canonicalName: 'revenue',
      label: 'Revenue',
      role: 'metric',
      semanticType: 'currency',
      defaultAggregation: 'sum',
    },
    {
      columnName: 'day',
      canonicalName: 'day',
      label: 'Day',
      role: 'dimension',
      semanticType: 'date',
      defaultAggregation: null,
    },
  ];
  const rows = columns.map((column) => ({
    ...column,
    id: uniqueId('field'),
    workspaceId: workspace.workspaceId,
    dataSourceId: id,
  }));
  await database.insert(fields).values(rows);
  const fieldIds = Object.fromEntries(
    rows.map((row) => [row.columnName, row.id]),
  ) as SeededDataSource['fieldIds'];
  return { id, name, version, fieldIds };
}

export function scorecardDefinition(source: SeededDataSource): WidgetDefinition {
  return {
    type: 'scorecard',
    title: 'Revenue',
    dataSourceId: source.id,
    dateRangeFieldId: source.fieldIds.day,
    metric: {
      source: { kind: 'field', fieldId: source.fieldIds.revenue, aggregation: 'sum' },
      dataType: 'currency',
    },
  };
}

export function regionControlDefinition(
  source: SeededDataSource,
  {
    allowMultiple = true,
    defaultValues,
  }: { allowMultiple?: boolean; defaultValues?: unknown[] } = {},
): Extract<WidgetDefinition, { type: 'control' }> {
  return {
    type: 'control',
    dataSourceId: source.id,
    fieldId: source.fieldIds.region,
    allowMultiple,
    ...(defaultValues ? { defaultValues } : {}),
  };
}

/** Creates a dashboard owned by the signed-in user and returns its persisted document. */
export async function createDashboard(name = uniqueId('Dashboard')) {
  return (await callService({ action: 'createDashboard', name })) as {
    id: string;
    widgets: unknown[];
  };
}

export async function addWidget(dashboardId: string, definition: WidgetDefinition) {
  const { widget } = (await callService({
    action: 'addWidget',
    dashboardId,
    definition,
    width: 4,
    height: 3,
  })) as { widget: { id: string } };
  return widget;
}

/** Asserts the service rejected a request with a specific API error. */
export async function expectApiError(
  operation: Promise<unknown>,
  expected: { status: number; code: string },
) {
  const error = await operation.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error, 'expected the request to be rejected').toBeInstanceOf(ApiError);
  expect({
    status: (error as ApiError).status,
    code: (error as ApiError).code,
  }).toEqual(expected);
  return error as ApiError;
}

/**
 * Runs `operation` with the Worker in R2 mode so storage calls hit the isolated R2 binding.
 * The binding type pins the production URLs, so the swap needs one cast.
 */
export async function withR2Storage<T>(operation: () => Promise<T>) {
  const bindings = env as unknown as Record<string, string>;
  const original = bindings.DATA_SOURCE_BASE_URL;
  bindings.DATA_SOURCE_BASE_URL = 'r2://yresonance-data';
  try {
    return await operation();
  } finally {
    bindings.DATA_SOURCE_BASE_URL = original;
  }
}
