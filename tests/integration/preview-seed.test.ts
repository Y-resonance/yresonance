import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { createDatabase } from '#/db/client';
import { dataSources, workspaces } from '#/db/schema';
import { handleInternalR2Request } from '#/data/internal-r2';
import { queryEngine } from './doubles/query-engine';
import { callService, expectApiError, signInToNewWorkspace, withR2Storage } from './fixtures';

const bindings = env as unknown as Record<string, string>;
const originalEnvironment = bindings.APP_ENV;
const db = createDatabase(env.DB);
const metrics = { queryDurationMs: 1, resultBytes: 4 };

interface Bootstrap {
  workspace: { id: string };
  dataSources: Array<{ id: string; name: string }>;
}

const bootstrap = () => callService({ action: 'bootstrap' }) as Promise<Bootstrap>;

// The engine is an external boundary. D1, R2, capability uploads and registration stay real.
async function convertExample(
  request: Extract<
    import('#/query/engine-contract').QueryEngineRequest,
    { operation: 'ingestCsv' }
  >,
) {
  const source = await handleInternalR2Request(new Request(request.sourceUrl), env);
  expect(source.ok).toBe(true);
  const csv = await source.text();
  expect(csv).toContain('Date,Advertiser,Campaign,Market,Platform');
  expect(csv).toContain('Acme Media,Spring Launch DE');
  const converted = 'PAR1';
  const stored = await handleInternalR2Request(
    new Request(request.destinationUrl, {
      method: 'PUT',
      body: converted,
      headers: { 'content-length': String(converted.length) },
    }),
    env,
  );
  expect(stored.status).toBe(201);
  return {
    body: {
      ok: true,
      data: { size: converted.length, etag: stored.headers.get('etag') },
      metrics,
    },
  };
}

function answerSeedRequests() {
  queryEngine.answerWith(async (request) => {
    if (request.operation === 'ingestCsv') return convertExample(request);
    return {
      body: {
        ok: true,
        data: {
          description: [
            { column_name: 'Date', column_type: 'DATE' },
            { column_name: 'Campaign', column_type: 'VARCHAR' },
            { column_name: 'Impressions', column_type: 'BIGINT' },
          ],
          samples: [{ Date: '2026-01-01', Campaign: 'Spring Launch DE', Impressions: 12000 }],
        },
        metrics,
      },
    };
  });
}

afterEach(() => {
  bindings.APP_ENV = originalEnvironment;
});

describe('preview example datasource', () => {
  test('concurrent bootstrap seeds once, discovers fields and preserves completion across rename and removal', async () => {
    const workspace = await signInToNewWorkspace();
    bindings.APP_ENV = 'preview';
    answerSeedRequests();
    await withR2Storage(async () => {
      const [first, second] = await Promise.all([bootstrap(), bootstrap()]);
      expect(first.dataSources).toEqual(second.dataSources);
      expect(first.dataSources).toHaveLength(1);
      const source = first.dataSources[0]!;
      expect(source.name).toBe('Example campaign data');
      const detail = (await callService({
        action: 'describeDatasource',
        dataSourceId: source.id,
      })) as {
        fields: Array<{ columnName: string; semanticType: string; role: string }>;
      };
      expect(detail.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ columnName: 'Date', semanticType: 'date' }),
          expect.objectContaining({ columnName: 'Impressions', role: 'metric' }),
        ]),
      );
      const objects = await env.DATA.list({ prefix: workspace.r2Prefix });
      expect(objects.objects).toHaveLength(1);
      expect(objects.objects[0]!.key).toMatch(/\.parquet$/u);
      await db
        .update(dataSources)
        .set({ name: 'My campaigns' })
        .where(eq(dataSources.id, source.id));
      expect((await bootstrap()).dataSources).toEqual([{ id: source.id, name: 'My campaigns' }]);
      await db.delete(dataSources).where(eq(dataSources.id, source.id));
      expect((await bootstrap()).dataSources).toEqual([]);
      expect(queryEngine.calls.filter((request) => request.operation === 'ingestCsv')).toHaveLength(
        1,
      );
    });
  });

  test.each(['ingestCsv', 'describeSource'] as const)(
    'failed %s cleans up and the next bootstrap retries',
    async (failedOperation) => {
      const workspace = await signInToNewWorkspace();
      bindings.APP_ENV = 'preview';
      // Fail inspection after conversion as well as before a destination exists.
      queryEngine.answerWith(async (request) => {
        if (request.operation === failedOperation)
          return { status: 503, body: { ok: false, error: 'Engine unavailable' } };
        if (request.operation !== 'ingestCsv') throw new Error('Unexpected engine request');
        return convertExample(request);
      });
      await withR2Storage(async () => {
        await expect(bootstrap()).rejects.toThrow('Engine unavailable');
        expect((await env.DATA.list({ prefix: workspace.r2Prefix })).objects).toEqual([]);
        expect(
          await db.query.dataSources.findMany({
            where: eq(dataSources.workspaceId, workspace.workspaceId),
          }),
        ).toEqual([]);
        const state = await db.query.workspaces.findFirst({
          where: eq(workspaces.id, workspace.workspaceId),
        });
        expect(state?.previewSeededAt).toBeNull();
        expect(state?.previewSeedClaimedAt).toBeNull();
        answerSeedRequests();
        expect((await bootstrap()).dataSources).toHaveLength(1);
      });
    },
  );

  test('an active claim waits for retry, an abandoned claim recovers, and another workspace gets its own example', async () => {
    const first = await signInToNewWorkspace();
    await db
      .update(workspaces)
      .set({ previewSeedClaimedAt: new Date().toISOString() })
      .where(eq(workspaces.id, first.workspaceId));
    bindings.APP_ENV = 'preview';
    answerSeedRequests();
    await withR2Storage(async () => {
      await expectApiError(bootstrap(), { status: 503, code: 'preview_seed_pending' });
      expect(queryEngine.calls).toEqual([]);
      await db
        .update(workspaces)
        .set({ previewSeedClaimedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
        .where(eq(workspaces.id, first.workspaceId));
      const firstResult = await bootstrap();
      const second = await signInToNewWorkspace();
      const secondResult = await bootstrap();
      expect(secondResult.dataSources).toHaveLength(1);
      expect(secondResult.dataSources[0]!.id).not.toBe(firstResult.dataSources[0]!.id);
      expect((await env.DATA.list({ prefix: second.r2Prefix })).objects).toHaveLength(1);
      expect((await env.DATA.list({ prefix: first.r2Prefix })).objects).toHaveLength(1);
    });
  });

  test.each(['production', 'development'])(
    '%s bootstrap leaves the workspace empty',
    async (environment) => {
      bindings.APP_ENV = environment;
      await withR2Storage(async () => {
        await signInToNewWorkspace();
        expect((await bootstrap()).dataSources).toEqual([]);
        expect(queryEngine.calls).toEqual([]);
      });
    },
  );
});
