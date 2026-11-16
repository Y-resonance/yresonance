import { AsyncLocalStorage } from 'node:async_hooks';
import { Client } from 'pg';
import { createDatabase } from '#/db/client';

type DatabaseScope = {
  connectionString: string;
  client?: Client;
  closing?: boolean;
  database?: ReturnType<typeof createDatabase>;
};
const scopes = new AsyncLocalStorage<DatabaseScope>();

// A Worker scope stays alive for streamed responses. Durable Object callers close explicitly.
export async function withDatabaseScope<T>(
  connectionString: string,
  operation: () => Promise<T>,
  close = false,
) {
  const scope: DatabaseScope = { connectionString };
  return scopes.run(scope, async () => {
    try {
      return await operation();
    } finally {
      if (close && scope.client) {
        scope.closing = true;
        await scope.client.end();
      }
    }
  });
}

export function database() {
  const scope = scopes.getStore();
  if (!scope) throw new Error('database() requires an invocation scope.');
  if (!scope.database) {
    scope.client = new Client({ connectionString: scope.connectionString });
    scope.client.on('error', () => {
      // pg-cloudflare can emit a socket error during an intentional close. Query errors
      // still reject their caller; idle failures need a listener to avoid an uncaught event.
      if (!scope.closing) console.error('yresonance.database_connection_failed');
    });
    // pg queues queries behind connection setup. Report connection errors through those queries.
    const connecting = scope.client.connect();
    scope.database = createDatabase(scope.client);
    void connecting.catch(() => undefined);
  }
  return scope.database;
}

export const UPLOAD_CLAIM_LEASE_MS = 60 * 60 * 1000;
