import { platform } from '#/platform/index.server';
import { env } from 'cloudflare:workers';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { database, withDatabaseScope } from '#/server/database.server';
import * as schema from '#/db/schema';
import { seedField } from '#/server/datasource-operations.server';
import {
  browserUploadPath,
  capabilityUrl,
  claimQueryReadBytes,
  createR2Capability,
  createQueryReadBudget,
  handleBrowserUploadRequest,
  handleInternalR2Request,
  MAX_QUERY_SOURCE_BYTES,
} from '#/data/internal-r2';
import { seedDataSource, signInToNewWorkspace } from './fixtures';

const now = () => new Date().toISOString();

describe('Postgres application storage', () => {
  test('scopes isolate clients, reuse the client within an invocation, and reject access outside a scope', async () => {
    const outer = database();
    expect(database()).toBe(outer);
    await withDatabaseScope(
      env.HYPERDRIVE.connectionString,
      async () => {
        expect(database()).not.toBe(outer);
        await database().execute(sql`SELECT 1`);
      },
      true,
    );
    expect(database()).toBe(outer);
  });

  test('the baseline roundtrips jsonb and booleans and cascades workspace deletion across every table', async () => {
    const workspace = await signInToNewWorkspace();
    const other = await signInToNewWorkspace();
    const source = await seedDataSource(workspace);
    const db = database();
    const id = crypto.randomUUID();
    const field = seedField(source.id, { column_name: 'sample', column_type: 'VARCHAR' }, [
      { sample: { 'bad\0key': ['\0x\ud800', '😀', '\\u0000'] } },
    ]);
    await db
      .insert(schema.fields)
      .values({ ...field, workspaceId: workspace.workspaceId, hidden: true });
    expect(
      await db.query.fields.findFirst({ where: eq(schema.fields.id, field.id) }),
    ).toMatchObject({
      hidden: true,
      sampleValues: [{ badkey: ['x', '😀', '\\u0000'] }],
    });
    await db.insert(schema.calculatedFields).values({
      id,
      workspaceId: workspace.workspaceId,
      dataSourceId: source.id,
      canonicalName: id,
      label: id,
      expression: '1',
      role: 'metric',
      semanticType: 'number',
      updatedAt: now(),
    });
    await db.insert(schema.libraryMetrics).values({
      id,
      workspaceId: workspace.workspaceId,
      name: id,
      canonicalName: id,
      expression: 'sum(1)',
      semanticType: 'number',
      updatedAt: now(),
    });
    await db.insert(schema.datasourceAuthorizations).values({
      id,
      workspaceId: workspace.workspaceId,
      provider: 'bigquery',
      createdBy: id,
      status: 'disconnected',
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.datasourceConnections).values({
      datasourceId: source.id,
      workspaceId: workspace.workspaceId,
      encryptedConfig: 'test',
    });
    await db.insert(schema.dashboards).values({
      id,
      workspaceId: workspace.workspaceId,
      name: id,
      document: { nested: [true, null, '😀'] },
      createdBy: id,
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.dashboardGrants).values({
      dashboardId: id,
      clerkUserId: id,
      role: 'editor',
      grantedBy: id,
      grantedAt: now(),
    });
    await db
      .insert(schema.shareLinks)
      .values({ token: id, dashboardId: id, createdBy: id, createdAt: now() });
    await db.insert(schema.datasourceUploads).values({
      key: id,
      workspaceId: workspace.workspaceId,
      clerkUserId: id,
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.ingestionTokens).values({
      id,
      workspaceId: workspace.workspaceId,
      sourceKey: id,
      destinationKey: id,
      expiresAt: now(),
      createdAt: now(),
    });
    await db.insert(schema.queryReadBudgets).values({
      id,
      workspaceId: workspace.workspaceId,
      maximumBytes: 500,
      expiresAt: now(),
      createdAt: now(),
    });
    await db.insert(schema.dashboardAssets).values({
      id,
      workspaceId: workspace.workspaceId,
      uploadedBy: id,
      name: id,
      contentType: 'image/png',
      size: 1,
      width: 1,
      height: 1,
      createdAt: now(),
    });
    const tables = Object.values(schema);
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspace.workspaceId));
    for (const table of tables) {
      const columns = getTableColumns(table);
      const owner =
        'workspaceId' in columns
          ? columns.workspaceId
          : 'dashboardId' in columns
            ? columns.dashboardId
            : schema.workspaces.id;
      const ownerId =
        'workspaceId' in columns || table === schema.workspaces ? workspace.workspaceId : id;
      expect(await db.select().from(table).where(eq(owner, ownerId))).toEqual([]);
    }
    expect(
      await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, other.workspaceId) }),
    ).toBeDefined();
  });

  test('pending uploads, one-use ingestion and concurrent range claims use real Postgres guards', async () => {
    const workspace = await signInToNewWorkspace();
    const id = crypto.randomUUID();
    const key = `${workspace.r2Prefix}${id}.csv`;
    const db = database();
    await db.insert(schema.datasourceUploads).values({
      key,
      workspaceId: workspace.workspaceId,
      clerkUserId: workspace.userId,
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    });
    const path = browserUploadPath(key);
    const upload = () =>
      handleBrowserUploadRequest(
        new Request(`https://test${path}`, {
          method: 'PUT',
          body: 'data',
          headers: { 'content-length': '4' },
        }),
        path.split('/').at(-1)!,
        platform.storage,
        {
          userId: workspace.userId,
          workspaceId: workspace.workspaceId,
          workspacePrefix: workspace.r2Prefix,
        },
      );
    expect((await upload()).status).toBe(201);
    await db
      .update(schema.datasourceUploads)
      .set({ status: 'registering' })
      .where(eq(schema.datasourceUploads.key, key));
    expect((await upload()).status).toBe(409);
    await createQueryReadBudget(id, workspace.workspaceId);
    await db
      .update(schema.queryReadBudgets)
      .set({ maximumBytes: 4 })
      .where(eq(schema.queryReadBudgets.id, id));
    await expect(claimQueryReadBytes(id, 2 ** 31)).resolves.toBe(false);
    const readToken = await createR2Capability(
      { kind: 'read', key, queryId: id },
      env.INTERNAL_R2_SIGNING_SECRET,
    );
    const read = () =>
      withDatabaseScope(
        env.HYPERDRIVE.connectionString,
        () =>
          handleInternalR2Request(
            new Request(capabilityUrl(readToken), { headers: { range: 'bytes=0-3' } }),
            { storage: platform.storage, settings: env },
          ),
        true,
      );
    const responses = await Promise.all([read(), read()]);
    expect(responses.map((r) => r.status).sort()).toEqual([206, 413]);
    await Promise.all(responses.map((r) => r.arrayBuffer()));
    expect(
      await db.query.queryReadBudgets.findFirst({ where: eq(schema.queryReadBudgets.id, id) }),
    ).toMatchObject({ scannedBytes: 4 });
    const destinationKey = `${workspace.r2Prefix}${id}.parquet`;
    await db.insert(schema.ingestionTokens).values({
      id,
      workspaceId: workspace.workspaceId,
      sourceKey: key,
      destinationKey,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now(),
    });
    const token = await createR2Capability(
      { kind: 'ingestion', tokenId: id, sourceKey: key, destinationKey },
      env.INTERNAL_R2_SIGNING_SECRET,
    );
    const ingest = () =>
      handleInternalR2Request(
        new Request(capabilityUrl(token), {
          method: 'PUT',
          body: 'data',
          headers: { 'content-length': '4' },
        }),
        { storage: platform.storage, settings: env },
      );
    const failure = vi.spyOn(env.DATA, 'put').mockRejectedValueOnce(new Error('R2 unavailable'));
    await expect(ingest()).rejects.toThrow('R2 unavailable');
    failure.mockRestore();
    expect(
      await db.query.ingestionTokens.findFirst({ where: eq(schema.ingestionTokens.id, id) }),
    ).toMatchObject({ usedAt: null });
    expect((await ingest()).status).toBe(201);
    expect((await ingest()).status).toBe(409);
    await db
      .delete(schema.queryReadBudgets)
      .where(
        and(
          eq(schema.queryReadBudgets.id, id),
          sql`${schema.queryReadBudgets.scannedBytes} <= ${MAX_QUERY_SOURCE_BYTES}`,
        ),
      );
  });
});
