import { Client } from 'pg';
const connectionString =
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
  'postgres://yresonance:yresonance@localhost:5432/yresonance';
const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  await client.query('SELECT 1');
} catch {
  console.error(
    'Local Postgres is unavailable. Run docker compose up -d, then bun run db:migrate:local.',
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
