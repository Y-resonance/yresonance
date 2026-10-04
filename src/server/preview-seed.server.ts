import { type SessionContext } from './auth.server';
import { env } from 'cloudflare:workers';
import { workspaces, dataSources, fields } from '#/db/schema';
import { and, eq, isNull, or, lt } from 'drizzle-orm';
import { ApiError } from './errors';
import previewExample from '../../.generated/preview-example.json';
import { hashJson } from '#/domain/hash';
import { DUCKDB_FILE_CONNECTOR } from '#/data/connectors/contract';
import { deleteSourceObject } from '#/data/source.server';
import { recordProductMetric } from '#/observability';
import { database, UPLOAD_CLAIM_LEASE_MS } from './database.server';
import { seedField } from './datasource-operations.server';

// Requests in one isolate share the import; D1 coordinates claims between isolates.
const previewSeeds = new Map<string, Promise<void>>();

export async function seedPreviewWorkspace(session: SessionContext) {
  if (env.APP_ENV !== 'preview' || session.workspace.previewSeededAt) return;
  const workspaceId = session.workspace.id;
  const pending = previewSeeds.get(workspaceId);
  if (pending) return pending;
  const seed = importPreviewExample(session);
  previewSeeds.set(workspaceId, seed);
  try {
    await seed;
  } finally {
    previewSeeds.delete(workspaceId);
  }
}

async function importPreviewExample(session: SessionContext) {
  const db = database();
  const workspaceId = session.workspace.id;
  const waitDeadline = Date.now() + 2 * 60 * 1000;
  let claim: string;
  while (true) {
    claim = new Date().toISOString();
    // Engine requests time out after 40 seconds. An hour allows recovery after a Worker crash.
    const expired = new Date(Date.now() - UPLOAD_CLAIM_LEASE_MS).toISOString();
    const claimed = await db
      .update(workspaces)
      .set({ previewSeedClaimedAt: claim })
      .where(
        and(
          eq(workspaces.id, workspaceId),
          isNull(workspaces.previewSeededAt),
          or(isNull(workspaces.previewSeedClaimedAt), lt(workspaces.previewSeedClaimedAt, expired)),
        ),
      )
      .returning({ id: workspaces.id });
    if (claimed.length) break;
    const current = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (current?.previewSeededAt) return;
    if (Date.now() >= waitDeadline)
      throw new ApiError(
        503,
        'preview_seed_pending',
        'Example data is still being prepared. Try again shortly.',
      );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  // Each attempt owns its object, including cleanup after a failed registration.
  const destinationKey = `${session.workspace.r2Prefix}examples/${crypto.randomUUID()}.parquet`;
  const startedAt = Date.now();
  try {
    const bytes = Uint8Array.from(atob(previewExample.parquet), (character) =>
      character.charCodeAt(0),
    );
    const object = await env.DATA.put(destinationKey, bytes, {
      httpMetadata: { contentType: 'application/vnd.apache.parquet' },
    });
    if (!object) throw new Error('Could not store the preview example.');
    const uploadedAt = Date.now();
    const existingNames = new Set(
      (
        await db
          .select({ name: dataSources.name })
          .from(dataSources)
          .where(eq(dataSources.workspaceId, workspaceId))
      ).map((source) => source.name),
    );
    let name = 'Example campaign data';
    for (let suffix = 2; existingNames.has(name); suffix++)
      name = `Example campaign data ${suffix}`;
    const id = `ds_${crypto.randomUUID()}`;
    const version = await hashJson([[destinationKey, object.etag]]);
    const now = new Date().toISOString();
    const discovered = previewExample.description.map((column) =>
      seedField(id, column, previewExample.samples),
    );
    await db.batch([
      db.insert(dataSources).values({
        id,
        workspaceId,
        name,
        connectorType: DUCKDB_FILE_CONNECTOR,
        location: { kind: 'object', key: destinationKey, format: 'parquet' },
        version,
        createdAt: now,
        updatedAt: now,
      }),
      ...discovered.map((field) => db.insert(fields).values({ ...field, workspaceId })),
      db
        .update(workspaces)
        .set({ previewSeededAt: now, previewSeedClaimedAt: null })
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.previewSeedClaimedAt, claim))),
    ]);
    console.info('yresonance.preview_seed_prepared', {
      workspaceId,
      exampleEndDate: previewExample.endDate,
      uploadDurationMs: uploadedAt - startedAt,
      registrationDurationMs: Date.now() - uploadedAt,
    });
  } catch (error) {
    await deleteSourceObject(destinationKey).catch(() => undefined);
    await db
      .update(workspaces)
      .set({ previewSeedClaimedAt: null })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.previewSeedClaimedAt, claim)));
    console.warn('yresonance.preview_seed', { workspaceId, result: 'error', error });
    recordProductMetric('preview_seed', { labels: ['error'], index: workspaceId });
    throw error;
  }
  console.info('yresonance.preview_seed', {
    workspaceId,
    result: 'success',
    durationMs: Date.now() - startedAt,
  });
  recordProductMetric('preview_seed', {
    labels: ['success'],
    numbers: [Date.now() - startedAt],
    index: workspaceId,
  });
}
