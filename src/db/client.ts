import { drizzle } from 'drizzle-orm/node-postgres';
import type { Client } from 'pg';
import * as schema from './schema';

export function createDatabase(client: Client) {
  return drizzle(client, { schema });
}
