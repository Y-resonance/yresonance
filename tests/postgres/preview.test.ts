import { Client } from 'pg';
import { afterEach, expect, test } from 'vitest';
import { managePreviewPostgres } from '../../scripts/postgres-preview';
import { previewClickhouseDatabase } from '../../scripts/preview-config';

// Provisioning runs in a Node build process, separately from Worker integration tests.
const url =
  process.env.TEST_DATABASE_URL ??
  'postgres://yresonance:yresonance@localhost:5432/yresonance_test';
const branches: string[] = [];
const configurations: Array<{
  id: string;
  name: string;
  caching: { disabled: boolean };
  origin: { user: string; database: string; password: string };
  origin_connection_limit: number;
}> = [];
const api = async (path: string, method = 'GET', body?: unknown) => {
  if (method === 'GET') return configurations;
  if (method === 'POST') {
    const config = {
      ...(body as Omit<(typeof configurations)[number], 'id'>),
      id: crypto.randomUUID(),
    };
    configurations.push(config);
    return config;
  }
  const index = configurations.findIndex((config) => path.endsWith(config.id));
  if (index >= 0) configurations.splice(index, 1);
  return null;
};
async function prepare() {
  const branch = `postgres-test-${crypto.randomUUID()}`;
  branches.push(branch);
  await managePreviewPostgres('prepare', branch, api);
  return branch;
}
afterEach(async () => {
  for (const branch of branches.splice(0)) await managePreviewPostgres('cleanup', branch, api);
});

test('prepare retries preserve rows and cleanup forcibly closes pooled connections after removing Hyperdrive', async () => {
  process.env.POSTGRES_PREVIEW_URL = url;
  process.env.POSTGRES_PREVIEW_RUNTIME_PASSWORD = 'preview-test-only';
  const branch = await prepare();
  const config = configurations[0]!;
  expect(config).toMatchObject({
    caching: { disabled: true },
    origin_connection_limit: 5,
    origin: { user: 'yresonance_preview_runtime', password: 'preview-test-only' },
  });
  const runtimeUrl = new URL(url);
  runtimeUrl.pathname = `/${previewClickhouseDatabase(branch)}`;
  runtimeUrl.username = config.origin.user;
  runtimeUrl.password = config.origin.password;
  const client = new Client({ connectionString: runtimeUrl.toString() });
  client.on('error', () => undefined); // FORCE drop terminates this simulated idle pool connection.
  await client.connect();
  try {
    await client.query(
      "INSERT INTO workspaces (id,clerk_organization_id,name,r2_prefix,created_at) VALUES ('retry','retry','retry','retry','today')",
    );
    await expect(client.query('CREATE DATABASE forbidden')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(client.query('CREATE TABLE forbidden (id text)')).rejects.toMatchObject({
      code: '42501',
    });
    await managePreviewPostgres('prepare', branch, api);
    expect(configurations).toHaveLength(1);
    expect((await client.query('SELECT id FROM workspaces')).rows).toEqual([{ id: 'retry' }]);
    await managePreviewPostgres('cleanup', branch, async (...args) => {
      expect((await client.query('SELECT 1')).rowCount).toBe(1);
      return api(...args);
    });
    expect(configurations).toHaveLength(0);
    await expect(client.query('SELECT 1')).rejects.toThrow();
    await managePreviewPostgres('cleanup', branch, api);
  } finally {
    await client.end();
  }
});

test('a fourth branch preview is refused before a database or Hyperdrive is created', async () => {
  process.env.POSTGRES_PREVIEW_URL = url;
  process.env.POSTGRES_PREVIEW_RUNTIME_PASSWORD = 'preview-test-only';
  await prepare();
  await prepare();
  await prepare();
  await expect(prepare()).rejects.toThrow('25-connection PlanetScale branch');
  expect(configurations).toHaveLength(3);
});
