import { drizzle } from 'drizzle-orm/node-postgres';
import type { Client } from 'pg';
import * as schema from './schema';

export function createDatabase(client: Client) {
  let connected: Promise<Client> | undefined;
  // Drizzle uses pg's promise query API. Connect on the first query and retain its result:
  // pg itself does not reject queued queries for every connection-phase failure.
  const readyClient = new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'query')
        return (...args: unknown[]) => {
          connected ??= target.connect();
          return connected.then(() => Reflect.apply(target.query, target, args));
        };
      return Reflect.get(target, key, receiver);
    },
  });
  return drizzle(readyClient, { schema });
}
