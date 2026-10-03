import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('DuckDB HTTPFS through an internal-style endpoint', () => {
  let directory: string;
  let server: Server;
  let port: number;
  const requests: Array<{ path: string; method: string; range: string | null }> = [];
  let activeRanges = 0;
  let maximumActiveRanges = 0;
  let releaseFirstRange: () => void = () => {};
  const secondRangeStarted = new Promise<void>((resolve) => {
    releaseFirstRange = resolve;
  });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'yresonance-httpfs-'));
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      for (const [name, offset] of [
        ['a', 0],
        ['b', 100_000],
      ] as const)
        await connection.run(
          `COPY (SELECT range + ${offset} AS id, repeat('yresonance', 20) AS value FROM range(100000)) TO '${join(directory, `${name}.parquet`).replaceAll("'", "''")}' (FORMAT PARQUET, ROW_GROUP_SIZE 10000)`,
        );
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        requests.push({
          path: url.pathname,
          method: request.method ?? 'GET',
          range: request.headers.range ?? null,
        });
        if (url.pathname === '/redirect-a')
          return response.writeHead(302, { location: '/a.parquet' }).end();
        const name =
          url.pathname === '/a.parquet' ? 'a' : url.pathname === '/b.parquet' ? 'b' : undefined;
        if (!name) return response.writeHead(404).end('Not found.');
        const path = join(directory, `${name}.parquet`);
        const size = (await stat(path)).size;
        const headers: Record<string, string> = {
          'accept-ranges': 'bytes',
          'content-type': 'application/vnd.apache.parquet',
        };
        if (request.method === 'HEAD') {
          headers['content-length'] = String(size);
          return response.writeHead(200, headers).end();
        }
        const range = parseRange(request.headers.range ?? null, size);
        if (!range) {
          headers['content-length'] = String(size);
          return response.writeHead(200, headers).end(await readFile(path));
        }
        activeRanges += 1;
        maximumActiveRanges = Math.max(maximumActiveRanges, activeRanges);
        if (activeRanges === 1) await waitForSecondRange(secondRangeStarted);
        else releaseFirstRange();
        activeRanges -= 1;
        headers['content-length'] = String(range.end - range.start + 1);
        headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
        const contents = await readFile(path);
        return response.writeHead(206, headers).end(contents.subarray(range.start, range.end + 1));
      } catch (error) {
        response.writeHead(500).end(error instanceof Error ? error.message : 'Server error.');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('HTTPFS test server did not bind.');
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });

  it('supports metadata, redirects, byte ranges, parallel reads, and explicit file lists', async () => {
    const instance = await DuckDBInstance.create(':memory:', { threads: '4' });
    const connection = await instance.connect();
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const result = await connection.runAndReadAll(
        `SELECT count(*) AS rows, min(id) AS first_id, max(id) AS last_id
         FROM read_parquet(['${baseUrl}/redirect-a', '${baseUrl}/b.parquet'])`,
      );
      expect(result.getRowObjectsJson()).toEqual([
        { rows: '200000', first_id: '0', last_id: '199999' },
      ]);
      const suffixResponse = await fetch(`${baseUrl}/a.parquet`, {
        headers: { range: 'bytes=-16' },
      });
      expect(suffixResponse.status).toBe(206);
      expect((await suffixResponse.arrayBuffer()).byteLength).toBe(16);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }

    expect(requests.some((request) => request.path === '/redirect-a')).toBe(true);
    expect(requests.some((request) => request.path === '/a.parquet' && request.range)).toBe(true);
    expect(requests.some((request) => request.path === '/b.parquet' && request.range)).toBe(true);
    expect(requests.some((request) => request.method === 'HEAD')).toBe(true);
    expect(maximumActiveRanges).toBeGreaterThan(1);
  });
});

function parseRange(value: string | null, size: number) {
  const match = value?.match(/^bytes=(?:(\d+)-(\d*)|-([1-9]\d*))$/u);
  if (!match) return undefined;
  if (match[3]) {
    const length = Math.min(Number(match[3]), size);
    return { start: size - length, end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return { start, end };
}

async function waitForSecondRange(secondRangeStarted: Promise<void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      secondRangeStarted,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('DuckDB serialized its range reads.')), 1_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
