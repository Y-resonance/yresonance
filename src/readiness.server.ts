import { sql } from 'drizzle-orm';
import { database } from '#/server/database.server';
import { env } from 'cloudflare:workers';
import { checkSourceStorage } from '#/data/source.server';

import {
  checkReadiness,
  createReadinessResponse,
  type ReadinessChecks,
  type ReadinessDependency,
} from './readiness';

const checks: ReadinessChecks = {
  postgres: async () => {
    await database().execute(sql`SELECT 1`);
  },
  kv: async () => {
    await env.QUERY_CACHE.get('__readiness__');
  },
  r2: async () => {
    await checkSourceStorage();
  },
};

export async function handleReadinessRequest() {
  const result = await checkReadiness(checks, logDependencyFailure);
  return createReadinessResponse(result);
}

function logDependencyFailure(dependency: ReadinessDependency, error: unknown) {
  console.error(
    JSON.stringify({
      event: 'readiness_check_failed',
      dependency,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}
