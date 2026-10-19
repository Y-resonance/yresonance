import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { fileDataPlugin } from '../../dev/file-data-plugin';
import { queryEnginePlugin } from '../../dev/query-engine-plugin';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

let server: ViteDevServer;
let directory: string;
let origin: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yresonance-dev-test-'));
  await writeFile(join(directory, 'report.csv'), 'value\n42\n');
  server = await createServer({
    configFile: false,
    plugins: [queryEnginePlugin(), fileDataPlugin(directory)],
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('rejects foreign-origin and simple query POSTs while accepting internal JSON requests', async () => {
  const body = JSON.stringify({ operation: 'query', sql: 'SELECT 42 AS answer' });
  for (const [headers, status] of [
    [{ 'content-type': 'text/plain' }, 415],
    [{ 'content-type': 'application/json', origin: 'https://attacker.test' }, 403],
    [{ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, 403],
    [
      { 'content-type': 'application/json', host: 'attacker.test', origin: 'http://attacker.test' },
      403,
    ],
  ] as const) {
    const response = await fetch(`${origin}/__query-engine`, { method: 'POST', headers, body });
    expect(response.status).toBe(status);
  }
  for (const headers of [
    new Headers({ 'content-type': 'application/json' }),
    new Headers({ 'content-type': 'application/json', origin }),
  ]) {
    const response = await fetch(`${origin}/__query-engine`, { method: 'POST', headers, body });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: [{ answer: 42 }] });
  }
});

it('rejects cross-origin file access and mutations before touching local files', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    expect(
      (
        await fetch(`${origin}/__dev-data/report.csv`, {
          method,
          headers: { origin: 'https://attacker.test' },
          ...(method === 'PUT' ? { body: 'changed' } : {}),
        })
      ).status,
    ).toBe(403);
  }
  expect(await (await fetch(`${origin}/__dev-data/report.csv`)).text()).toBe('value\n42\n');
});
