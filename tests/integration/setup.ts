import { withDatabaseScope } from '#/server/database.server';
import { env } from 'cloudflare:workers';
import { afterEach, aroundEach, beforeEach, vi } from 'vitest';
import { resetClerk } from './doubles/clerk';
import { queryEngine } from './doubles/query-engine';

aroundEach(async (run) => {
  await withDatabaseScope(env.HYPERDRIVE.connectionString, run, true);
});

beforeEach(async () => {
  queryEngine.install();
  // Postgres rows stay unique per test through generated ids; cache keys are content-derived,
  // so the KV namespace is the one binding that needs clearing between tests.
  const { keys } = await env.QUERY_CACHE.list();
  await Promise.all(keys.map((key) => env.QUERY_CACHE.delete(key.name)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  queryEngine.reset();
  resetClerk();
});
