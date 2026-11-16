import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
export default async function setup() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      'postgres://yresonance:yresonance@localhost:5432/yresonance_test',
  );
  if (!url.pathname.endsWith('_test'))
    throw new Error('TEST_DATABASE_URL must name a dedicated _test database.');
  const client = new Client({ connectionString: url.toString() });
  try {
    await client.connect();
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  } finally {
    await client.end();
  }
}
