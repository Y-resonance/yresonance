import { platform } from '#/platform/index.server';
import { settings, type Settings } from '#/platform/settings';
import type { Storage, Cache } from '#/platform/config';
import { sql } from 'drizzle-orm';
import { database } from '#/server/database.server';
import { z } from 'zod';

const resetRequestSchema = z.object({
  environment: z.enum(['development', 'preview', 'production']),
});

const applicationTables = [
  'dashboard_grants',
  'share_links',
  'dashboards',
  'calculated_fields',
  'fields',
  'library_metrics',
  'datasource_connections',
  'data_sources',
  'datasource_uploads',
  'ingestion_tokens',
  'query_read_budgets',
  'dashboard_assets',
  'workspaces',
  'users',
] as const;

export async function handleResetRequest(
  request: Request,
  environment: {
    storage: Storage;
    cache: Cache;
    settings: Pick<Settings, 'RESET_ADMIN_TOKEN' | 'APP_ENV' | 'QUERY_CACHE_NAME'>;
  } = { storage: platform.storage, cache: platform.cache, settings: settings() },
) {
  if (request.method !== 'POST')
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers: { allow: 'POST' } },
    );
  if (
    !(await authorized(
      request.headers.get('authorization'),
      environment.settings.RESET_ADMIN_TOKEN,
    ))
  )
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = resetRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success)
    return Response.json({ error: 'Choose development, preview, or production.' }, { status: 400 });
  if (parsed.data.environment !== environment.settings.APP_ENV)
    return Response.json(
      {
        error: `This deployment is ${environment.settings.APP_ENV}, not ${parsed.data.environment}.`,
      },
      { status: 409 },
    );

  const [r2Keys, kvKeys] = await Promise.all([
    listR2Keys(environment.storage),
    listKvKeys(environment.cache),
  ]);
  const plan = {
    environment: parsed.data.environment,
    databaseTables: [...applicationTables],
    r2ObjectKeys: r2Keys,
    kvNamespace: environment.settings.QUERY_CACHE_NAME,
    kvKeys,
  };
  if (parsed.data.environment === 'production')
    return Response.json({ executed: false, reason: 'Production resets are manual.', plan });

  await database().transaction(async (tx) => {
    for (const table of applicationTables) await tx.execute(sql.raw(`DELETE FROM "${table}"`));
  });
  for (let index = 0; index < r2Keys.length; index += 1_000)
    await environment.storage.delete(r2Keys.slice(index, index + 1_000));
  for (let index = 0; index < kvKeys.length; index += 50)
    await Promise.all(kvKeys.slice(index, index + 50).map((key) => environment.cache.delete(key)));
  return Response.json({ executed: true, plan });
}

async function listR2Keys(bucket: Storage) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1_000 });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function listKvKeys(namespace: Cache) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await namespace.list({ cursor, limit: 1_000 });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function authorized(header: string | null, expected: string) {
  const supplied = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const [left, right] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return supplied.length > 0 && difference === 0;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
