#!/usr/bin/env node
// Command line of the installed package. Plain JavaScript, because Node does not run TypeScript
// from node_modules.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const [command] = process.argv.slice(2);

if (command !== 'migrate') {
  console.error(
    'Usage: yresonance migrate\n\nApplies pending database migrations to DATABASE_URL.',
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the Postgres connection string to migrate.');
  process.exit(1);
}

const database = drizzle(url);
try {
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log('Database migrations are up to date.');
} finally {
  await database.$client.end();
}
