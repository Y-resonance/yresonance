import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { hashJson } from '#/domain/hash';
import type { DataSourceRecord } from '#/query/types';
import { quoteSqlIdentifier } from '#/query/dialect';
import { DatasourceError } from './connectors/contract';

const configurationSchema = z.object({
  CLICKHOUSE_URL: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    );
  }),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),
  CLICKHOUSE_ACCESS_CLIENT_ID: z.string().optional(),
  CLICKHOUSE_ACCESS_CLIENT_SECRET: z.string().optional(),
});
const accessMappingsSchema = z.array(
  z.object({
    workspaceId: z.string().min(1),
    database: z.string().min(1),
    table: z.string().min(1),
  }),
);
const resultSchema = z.object({
  meta: z.array(z.object({ name: z.string(), type: z.string() })),
  data: z.array(z.record(z.string(), z.unknown())),
  statistics: z
    .object({ elapsed: z.number(), rows_read: z.number(), bytes_read: z.number() })
    .optional(),
});

export function managedClickhouseDatabase() {
  const database = z
    .string()
    .regex(/^yresonance_[a-z0-9_]+$/)
    .max(100)
    .safeParse(env.CLICKHOUSE_DATABASE);
  if (!database.success)
    throw new DatasourceError(
      'datasource_connector_failed',
      'ClickHouse database is not configured.',
    );
  return database.data;
}

export async function authorizedClickhouseTable(dataSource: Omit<DataSourceRecord, 'version'>) {
  const location = dataSource.location;
  if (location.kind !== 'clickhouse')
    throw new DatasourceError('invalid_query', 'ClickHouse requires a table source.');
  const managedDatabase = managedClickhouseDatabase();
  if (location.ownership === 'managed') {
    if (
      location.database !== managedDatabase ||
      location.table !== (await managedTableName(dataSource.workspaceId, dataSource.id))
    )
      throw new DatasourceError(
        'datasource_access_denied',
        'This ClickHouse table belongs to another workspace.',
      );
  } else {
    let mappings: z.infer<typeof accessMappingsSchema>;
    try {
      mappings = accessMappingsSchema.parse(JSON.parse(env.CLICKHOUSE_EXTERNAL_TABLES ?? '[]'));
    } catch {
      throw new DatasourceError(
        'datasource_connector_failed',
        'ClickHouse access mappings are invalid.',
      );
    }
    if (
      location.database.startsWith('yresonance_') ||
      !mappings.some(
        (mapping) =>
          mapping.workspaceId === dataSource.workspaceId &&
          mapping.database === location.database &&
          mapping.table === location.table,
      )
    )
      throw new DatasourceError(
        'datasource_access_denied',
        'This external ClickHouse table is not authorized for this workspace.',
      );
  }
  return clickhouseTableSql(location.database, location.table);
}

export async function managedTableName(workspaceId: string, id: string) {
  return `ws_${await hashJson(workspaceId)}_${id.replaceAll('-', '_')}`;
}
export function clickhouseTableSql(database: string, table: string) {
  return `${quoteSqlIdentifier(database, 'clickhouse')}.${quoteSqlIdentifier(table, 'clickhouse')}`;
}

// Bind only generated placeholders, leaving quoted strings and identifiers untouched.
export function bindClickhouseParameters(sql: string, parameters: unknown[]) {
  let index = 0;
  const values: Record<string, string> = {};
  const bound = sql.replace(/'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|\?/gu, (token) => {
    if (token !== '?') return token;
    if (index >= parameters.length)
      throw new DatasourceError('invalid_query', 'Missing query parameter.');
    const value = parameters[index];
    const name = `p${index++}`;
    const type =
      value === null
        ? 'Nullable(String)'
        : typeof value === 'number'
          ? 'Float64'
          : typeof value === 'boolean'
            ? 'Bool'
            : 'String';
    const parsed = z
      .union([z.string(), z.number().finite(), z.boolean(), z.null()])
      .safeParse(value);
    if (!parsed.success)
      throw new DatasourceError('invalid_query', 'Query parameters must be scalar values.');
    // HTTP parameters use ClickHouse's escaped text format.
    values[`param_${name}`] =
      value === null
        ? '\\N'
        : String(value)
            .replaceAll('\\', '\\\\')
            .replaceAll('\t', '\\t')
            .replaceAll('\n', '\\n')
            .replaceAll('\r', '\\r');
    return `{${name}:${type}}`;
  });
  if (index !== parameters.length)
    throw new DatasourceError('invalid_query', 'Unexpected query parameter.');
  return { sql: bound, values };
}

export async function clickhouseRequest(
  workspaceId: string,
  sql: string,
  parameters: unknown[] = [],
  options: { body?: ReadableStream<Uint8Array>; readonly?: boolean } = {},
) {
  const config = configurationSchema.safeParse(env);
  if (!config.success)
    throw new DatasourceError('datasource_connector_failed', 'ClickHouse is not configured.');
  const queryId = crypto.randomUUID();
  const startedAt = Date.now();
  const bound = bindClickhouseParameters(sql, parameters);
  const url = new URL(config.data.CLICKHOUSE_URL);
  url.searchParams.set('query_id', queryId);
  url.searchParams.set('wait_end_of_query', '1');
  url.searchParams.set('max_execution_time', '30');
  url.searchParams.set('max_result_bytes', '16777216');
  url.searchParams.set('result_overflow_mode', 'throw');
  url.searchParams.set('output_format_json_quote_64bit_integers', '1');
  url.searchParams.set('output_format_json_quote_decimals', '1');
  url.searchParams.set('group_by_use_nulls', '1');
  url.searchParams.set('aggregate_functions_null_for_empty', '1');
  url.searchParams.set('cast_keep_nullable', '1');
  if (options.readonly !== false) url.searchParams.set('readonly', '1');
  for (const [key, value] of Object.entries(bound.values)) url.searchParams.set(key, value);
  if (options.body) url.searchParams.set('query', bound.sql);
  const headers = new Headers({
    'User-Agent': 'yresonance-analytics/1.0',
    'X-ClickHouse-User': config.data.CLICKHOUSE_USER,
    'X-ClickHouse-Key': config.data.CLICKHOUSE_PASSWORD,
  });
  if (config.data.CLICKHOUSE_ACCESS_CLIENT_ID && config.data.CLICKHOUSE_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id', config.data.CLICKHOUSE_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', config.data.CLICKHOUSE_ACCESS_CLIENT_SECRET);
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: options.body ?? bound.sql,
      signal: AbortSignal.timeout(40_000),
      redirect: 'manual',
    });
    // Server exceptions can include SQL, URLs, and settings. Never expose or log their body.
    if (!response.ok || response.headers.has('X-ClickHouse-Exception-Code')) {
      await response.body?.cancel();
      throw new DatasourceError(
        'datasource_connector_failed',
        'ClickHouse could not complete the request.',
      );
    }
    const text = await response.text();
    const result = text.trim() ? resultSchema.parse(JSON.parse(text)) : undefined;
    console.info('yresonance.query_execution', {
      backend: 'clickhouse',
      workspaceId,
      queryId,
      outcome: 'success',
      durationMs: Date.now() - startedAt,
      scannedRows: result?.statistics?.rows_read,
      scannedBytes: result?.statistics?.bytes_read,
      queryDurationMs: result ? (result.statistics?.elapsed ?? 0) * 1000 : undefined,
      resultRows: result?.data.length,
      resultBytes: new TextEncoder().encode(text).byteLength,
    });
    return result;
  } catch (error) {
    console.warn('yresonance.query_execution', {
      backend: 'clickhouse',
      workspaceId,
      queryId,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
    });
    if (error instanceof DatasourceError) throw error;
    throw new DatasourceError(
      'datasource_connector_failed',
      'ClickHouse could not complete the request.',
    );
  }
}

export function normalizeClickhouseRows(result: z.infer<typeof resultSchema>) {
  // Match DuckDB's JSON representation: small integers are numbers, 64-bit integers are strings.
  const types = new Map(result.meta.map((column) => [column.name, column.type]));
  return result.data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([name, value]) => {
        const type = types.get(name) ?? '';
        const decimalScale = type.match(/Decimal\(\d+,\s*(\d+)\)/u)?.[1];
        if (decimalScale !== undefined && typeof value === 'string') {
          const [integer, fraction = ''] = value.split('.');
          const scale = Number(decimalScale);
          return [name, scale === 0 ? integer : `${integer}.${fraction.padEnd(scale, '0')}`];
        }

        if (/DateTime/u.test(type) && typeof value === 'string')
          return [name, value.replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '')];
        return [name, value];
      }),
    ),
  );
}
