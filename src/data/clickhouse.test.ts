import { afterEach, expect, test, vi } from 'vitest';
import { bindClickhouseParameters, clickhouseRequest } from './clickhouse.server';

vi.mock('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_URL: 'https://clickhouse.test',
    CLICKHOUSE_USER: 'backend',
    CLICKHOUSE_PASSWORD: 'private-password',
    CLICKHOUSE_ACCESS_CLIENT_ID: 'private-id',
    CLICKHOUSE_ACCESS_CLIENT_SECRET: 'private-access-secret',
    CLICKHOUSE_DATABASE: 'yresonance_development',
  },
}));
afterEach(() => vi.unstubAllGlobals());

test('parameters cannot replace question marks in strings or quoted column names', () => {
  const bound = bindClickhouseParameters(
    `SELECT "column?", 'why?', 'it''s?' WHERE "name" = ? AND "amount" > ?`,
    ["O'Reilly\\?\n", 4],
  );
  expect(bound.sql).toBe(
    `SELECT "column?", 'why?', 'it''s?' WHERE "name" = {p0:String} AND "amount" > {p1:Float64}`,
  );
  expect(bound.values).toEqual({ param_p0: "O'Reilly\\\\?\\n", param_p1: '4' });
  expect(() => bindClickhouseParameters('SELECT ?', [])).toThrow('Missing query parameter');
  expect(() => bindClickhouseParameters('SELECT 1', ['extra'])).toThrow(
    'Unexpected query parameter',
  );
});

test('redirects and server exceptions fail without forwarding or exposing credentials', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response('private-password private-access-secret', {
      status: 302,
      headers: { location: 'https://another-host.test' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(clickhouseRequest('workspace', 'SELECT 1 FORMAT JSON')).rejects.toThrow(
    'ClickHouse could not complete the request.',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  fetch.mockResolvedValue(
    new Response('DB::Exception: private-password', {
      status: 200,
      headers: { 'X-ClickHouse-Exception-Code': '497' },
    }),
  );
  await expect(clickhouseRequest('workspace', 'SELECT 1 FORMAT JSON')).rejects.toThrow(
    'ClickHouse could not complete the request.',
  );
});
