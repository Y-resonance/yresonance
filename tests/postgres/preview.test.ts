import { Client } from 'pg';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { inspect } from 'node:util';
import { afterEach, expect, test, vi } from 'vitest';
import { managePreviewPostgres } from '../../cloud/scripts/postgres-preview';
import { previewClickhouseDatabase } from '../../cloud/scripts/preview-config';

// Provisioning runs in a Node build process, separately from Worker integration tests.
const url =
  process.env.TEST_DATABASE_URL ??
  'postgres://yresonance:yresonance@localhost:5432/yresonance_test';
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Provisioning tests require a dedicated _test database.');
const branches: string[] = [];
const configurations: Array<{
  id: string;
  name: string;
  caching: { disabled: boolean };
  origin: { user: string; database: string; password: string };
  origin_connection_limit: number;
}> = [];
const api = async (path: string, method = 'GET', body?: unknown) => {
  if (method === 'GET') {
    const page = Number(new URL(path, 'https://cloudflare.test').searchParams.get('page') ?? 1);
    return structuredClone(configurations.slice((page - 1) * 20, page * 20));
  }
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
  configurations.length = 0;
});

test('prepare retries preserve rows and cleanup forcibly closes pooled connections after removing Hyperdrive', async () => {
  process.env.POSTGRES_PREVIEW_URL = url;
  process.env.POSTGRES_PREVIEW_RUNTIME_PASSWORD = 'preview-test-only';
  const branch = `postgres-test-${crypto.randomUUID()}`;
  branches.push(branch);
  const ids = await Promise.all([
    managePreviewPostgres('prepare', branch, api),
    managePreviewPostgres('prepare', branch, api),
  ]);
  expect(ids[0]).toBe(ids[1]);
  expect(configurations).toHaveLength(1);
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
    configurations.unshift(
      ...Array.from({ length: 20 }, (_, index) => ({
        ...config,
        id: `unrelated-${index}`,
        name: `unrelated-${index}`,
      })),
    );
    await managePreviewPostgres('prepare', branch, api);
    expect(configurations).toHaveLength(21);
    expect((await client.query('SELECT id FROM workspaces')).rows).toEqual([{ id: 'retry' }]);
    await managePreviewPostgres('cleanup', branch, async (...args) => {
      expect((await client.query('SELECT 1')).rowCount).toBe(1);
      return api(...args);
    });
    expect(configurations).toHaveLength(20);
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

test.each([
  { metadata: { status: 403 }, diagnostic: 'HTTP 403' },
  { metadata: { code: 'ECONNRESET' }, diagnostic: 'code=ECONNRESET' },
  {
    metadata: {
      cause: new DrizzleQueryError(
        'CREATE ROLE test PASSWORD secret-password',
        ['secret-token'],
        Object.assign(new Error('secret-user'), { code: '42501' }),
      ),
    },
    diagnostic: 'code=42501',
  },
  {
    metadata: { code: 'postgres://secret-user:secret-password@example.test' },
    diagnostic: undefined,
  },
])(
  'cleanup reports its failing operation with safe metadata: $metadata',
  async ({ metadata, diagnostic }) => {
    process.env.POSTGRES_PREVIEW_URL = url;
    process.env.POSTGRES_PREVIEW_RUNTIME_PASSWORD = 'preview-test-only';
    const branch = await prepare();
    const failure = Object.assign(new Error('secret-password and secret-token'), metadata, {
      query: 'CREATE ROLE test PASSWORD secret-password',
      detail: 'secret-token',
    });
    const error = await managePreviewPostgres('cleanup', branch, async (...args) => {
      if (args[1] === 'DELETE') throw failure;
      return api(...args);
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('during delete Hyperdrive configuration');
    if (diagnostic) expect(String(error)).toContain(diagnostic);
    expect(inspect(error)).not.toMatch(/secret-password|secret-token|secret-user|CREATE ROLE/);
    expect(configurations).toHaveLength(1);
  },
);

test('Postgres authentication failures retain SQLSTATE without exposing credentials', async () => {
  const invalid = new URL(url);
  invalid.password = 'invalid-secret-password';
  process.env.POSTGRES_PREVIEW_URL = invalid.toString();
  try {
    const error = await managePreviewPostgres('cleanup', 'authentication-test', api).catch(
      (error: unknown) => error,
    );
    expect(String(error)).toContain('during connect to Postgres; code=28P01');
    expect(inspect(error)).not.toContain('invalid-secret-password');
  } finally {
    process.env.POSTGRES_PREVIEW_URL = url;
  }
});

test('diagnostics inspect access without provisioning or deleting resources', async () => {
  process.env.POSTGRES_PREVIEW_URL = url;
  process.env.POSTGRES_PREVIEW_RUNTIME_PASSWORD = 'preview-test-only';
  const branch = await prepare();
  const config = configurations[0]!;
  const output = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    await managePreviewPostgres('diagnose', 'preview-diagnostics', async (...args) => {
      expect(args[1]).toBeUndefined();
      return api(...args);
    });
    expect(configurations).toHaveLength(1);
    expect(output).toHaveBeenCalledWith('yresonance.postgres_preview_diagnostic', {
      postgres: 'connected',
      databases: expect.arrayContaining([
        { database: previewClickhouseDatabase(branch), canDrop: true },
      ]),
      hyperdrive: 'readable',
      configurations: [config.name],
    });
  } finally {
    output.mockRestore();
  }
});
