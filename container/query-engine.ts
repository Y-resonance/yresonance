import { DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

export const MAX_QUERY_RESULT_BYTES = 5 * 1024 * 1024;
export const QUERY_TIMEOUT_MS = 30_000;
export const queryEngineRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('query'),
    sql: z.string().min(1).max(100_000),
    parameters: z.array(z.unknown()).default([]),
  }),
  z.object({
    operation: z.literal('describeSource'),
    sourceSql: z.string().min(1).max(100_000),
  }),
  z.object({
    operation: z.literal('ingestCsv'),
    sourceUrl: z.url(),
    destinationUrl: z.url(),
  }),
]);

export async function executeQueryEngineRequest(input: unknown) {
  const request = queryEngineRequestSchema.parse(input);
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    await connection.run("SET memory_limit = '192MB'");
    await connection.run('SET threads = 2');

    if (request.operation === 'describeSource') {
      const description = await connection.runAndReadAll(
        `DESCRIBE SELECT * FROM ${request.sourceSql}`,
      );
      const samples = await connection.runAndReadAll(`SELECT * FROM ${request.sourceSql} LIMIT 20`);
      return {
        description: description.getRowObjectsJson(),
        samples: samples.getRowObjectsJson(),
      };
    }

    if (request.operation === 'ingestCsv') {
      const directory = await mkdtemp(join(tmpdir(), 'yresonance-ingest-'));
      const destination = join(directory, 'datasource.parquet');
      try {
        await runWithTimeout(connection, async () => {
          const source = `read_csv_auto(${sqlString(request.sourceUrl)}, header = true)`;
          const projection = await csvIngestionProjection(connection, source);
          await connection.run(
            `COPY (SELECT ${projection} FROM ${source}) TO ${sqlString(destination)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
          );
        });
        const file = await openAsBlob(destination);
        const response = await fetch(request.destinationUrl, {
          method: 'PUT',
          headers: { 'content-length': String(file.size) },
          body: file,
          signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
        });
        if (!response.ok)
          throw new Error(
            `Parquet upload returned HTTP ${response.status}: ${await response.text()}`,
          );
        return { size: file.size, etag: response.headers.get('etag') };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }

    const result = await runWithTimeout(connection, async () => {
      const statement = await connection.prepare(request.sql);
      statement.bind(request.parameters as DuckDBValue[]);
      return statement.runAndReadAll();
    });
    const rows = result.getRowObjectsJson();
    const resultBytes = new TextEncoder().encode(JSON.stringify(rows)).byteLength;
    if (resultBytes > MAX_QUERY_RESULT_BYTES)
      throw new Error(`Query result exceeds the ${MAX_QUERY_RESULT_BYTES} byte limit.`);
    return rows;
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function runWithTimeout<T>(
  connection: { interrupt(): void },
  operation: () => Promise<T>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          connection.interrupt();
          reject(new Error(`Query exceeded the ${QUERY_TIMEOUT_MS} ms time limit.`));
        }, QUERY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const javascriptDatePattern =
  '^[A-Za-z]{3} [A-Za-z]{3} [0-9]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT[+-][0-9]{4}( \\(.*\\))?$';

/** Converts columns containing only JavaScript Date.toString() values to physical Parquet dates. */
async function csvIngestionProjection(
  connection: {
    runAndReadAll(sql: string): Promise<{ getRowObjectsJson(): Record<string, unknown>[] }>;
  },
  source: string,
) {
  const description = await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`);
  const varcharColumns = description
    .getRowObjectsJson()
    .filter((column) => column.column_type === 'VARCHAR')
    .map((column) => String(column.column_name));
  if (varcharColumns.length === 0) return '*';

  const checks = varcharColumns.map((column, index) => {
    const identifier = quoteIdentifier(column);
    return `COALESCE(BOOL_AND(${identifier} IS NULL OR TRIM(${identifier}) = '' OR (REGEXP_FULL_MATCH(${identifier}, ${sqlString(javascriptDatePattern)}) AND TRY_STRPTIME(SUBSTR(${identifier}, 1, 15), '%a %b %d %Y') IS NOT NULL)), FALSE) AND COUNT_IF(${identifier} IS NOT NULL AND TRIM(${identifier}) <> '') > 0 AS ${quoteIdentifier(`date_${index}`)}`;
  });
  const result = await connection.runAndReadAll(`SELECT ${checks.join(', ')} FROM ${source}`);
  const detected = result.getRowObjectsJson()[0] ?? {};
  const replacements = varcharColumns.flatMap((column, index) =>
    detected[`date_${index}`] === true
      ? [
          `CAST(TRY_STRPTIME(SUBSTR(${quoteIdentifier(column)}, 1, 15), '%a %b %d %Y') AS DATE) AS ${quoteIdentifier(column)}`,
        ]
      : [],
  );
  return replacements.length === 0 ? '*' : `* REPLACE (${replacements.join(', ')})`;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
