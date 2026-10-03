import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { executeQueryEngineRequest, queryEngineRequestSchema } from './query-engine';

const sourceSql = '(VALUES (1, 10), (2, 20)) AS source(day, spend)';

describe('native query engine', () => {
  it('queries an authorized source directly and binds parameters', async () => {
    await expect(
      executeQueryEngineRequest({
        operation: 'query',
        sql: `SELECT SUM(spend) AS total FROM ${sourceSql} WHERE day >= ?`,
        parameters: [2],
      }),
    ).resolves.toEqual([{ total: '20' }]);
  });

  it('strips credential-bearing fields from the request shape', () => {
    const parsed = queryEngineRequestSchema.parse({
      operation: 'query',
      sourceSql,
      requiresR2Credentials: true,
      sql: `SELECT * FROM ${sourceSql}`,
      parameters: [],
    });
    expect(parsed).not.toHaveProperty('sourceSql');
    expect(parsed).not.toHaveProperty('requiresR2Credentials');
  });

  it('describes and samples a trusted source', async () => {
    const result = await executeQueryEngineRequest({ operation: 'describeSource', sourceSql });
    expect(result).toMatchObject({
      description: [
        { column_name: 'day', column_type: 'INTEGER' },
        { column_name: 'spend', column_type: 'INTEGER' },
      ],
      samples: [
        { day: 1, spend: 10 },
        { day: 2, spend: 20 },
      ],
    });
  });

  it('converts HTTP CSV input to queryable Parquet and uploads it with PUT', async () => {
    const csv = Buffer.from(
      [
        'Date,label,spend',
        'Mon Feb 16 2026 00:00:00 GMT+0100 (Mitteleuropäische Normalzeit),north,10',
        'Tue Feb 17 2026 00:00:00 GMT+0100 (Mitteleuropäische Normalzeit),south,20',
        '',
      ].join('\n'),
    );
    let uploaded: Buffer | undefined;
    const server = createServer(async (request, response) => {
      if (
        request.url === '/source.csv' &&
        (request.method === 'GET' || request.method === 'HEAD')
      ) {
        response.writeHead(200, {
          'content-length': String(csv.byteLength),
          'content-type': 'text/csv',
        });
        return response.end(request.method === 'HEAD' ? undefined : csv);
      }
      if (request.url === '/destination.parquet' && request.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        uploaded = Buffer.concat(chunks);
        return response.writeHead(201, { etag: '"uploaded"' }).end();
      }
      return response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Ingestion test server did not bind.');
    const directory = await mkdtemp(join(tmpdir(), 'yresonance-ingestion-proof-'));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const result = await executeQueryEngineRequest({
        operation: 'ingestCsv',
        sourceUrl: `http://127.0.0.1:${address.port}/source.csv`,
        destinationUrl: `http://127.0.0.1:${address.port}/destination.parquet`,
      });
      expect(result).toMatchObject({ etag: '"uploaded"' });
      if (!('size' in result) || result.size === undefined)
        throw new Error('Ingestion did not return an uploaded file.');
      expect(uploaded?.byteLength).toBe(result.size);
      expect(timeout).toHaveBeenCalledWith(30_000);
      if (!uploaded) throw new Error('Ingestion did not upload Parquet bytes.');

      const path = join(directory, 'uploaded.parquet');
      await writeFile(path, uploaded);
      await expect(
        executeQueryEngineRequest({
          operation: 'query',
          sql: `SELECT count(*) AS rows, sum(spend) AS spend, min("Date") AS first_date FROM read_parquet('${path.replaceAll("'", "''")}') WHERE "Date" BETWEEN DATE '2026-02-16' AND DATE '2026-02-17'`,
          parameters: [],
        }),
      ).resolves.toEqual([{ rows: '2', spend: '30', first_date: '2026-02-16' }]);
      await expect(
        executeQueryEngineRequest({
          operation: 'describeSource',
          sourceSql: `read_parquet('${path.replaceAll("'", "''")}')`,
        }),
      ).resolves.toMatchObject({
        description: [
          { column_name: 'Date', column_type: 'DATE' },
          { column_name: 'label', column_type: 'VARCHAR' },
          { column_name: 'spend', column_type: 'BIGINT' },
        ],
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
      timeout.mockRestore();
    }
  });
});
