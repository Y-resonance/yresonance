import { z } from 'zod';
import { DatasourceError } from './connectors/contract';
import { readResponseText } from './http-response';
import { recordProductMetric } from '#/observability';

const columnSchema = z.object({ name: z.string(), type: z.string(), mode: z.string().optional() });
export const tableSchema = z.object({
  type: z.string(),
  location: z.string(),
  schema: z.object({ fields: z.array(columnSchema) }),
  requirePartitionFilter: z.boolean().optional(),
});
const resultSchema = z.object({
  jobComplete: z.boolean(),
  schema: z.object({ fields: z.array(columnSchema) }).optional(),
  rows: z.array(z.object({ f: z.array(z.object({ v: z.unknown() })) })).optional(),
  pageToken: z.string().optional(),
  errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  totalBytesProcessed: z.string().optional(),
  cacheHit: z.boolean().optional(),
});
const MAX_RESULT_BYTES = 10 * 1024 * 1024;
const MAX_RESULT_ROWS = 20_000;

export function bigqueryTablePath(source: { project: string; dataset: string; table: string }) {
  return `projects/${encodeURIComponent(source.project)}/datasets/${encodeURIComponent(source.dataset)}/tables/${encodeURIComponent(source.table)}`;
}

// Google answers outages and proxy errors with HTML pages. Those must surface as a connector
// failure, not as a JSON parse exception that the API maps to an internal error.
export async function readJsonResponse(response: Response, maximumBytes: number): Promise<unknown> {
  const text = await readResponseText(response, maximumBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new DatasourceError(
      'datasource_connector_failed',
      `Google returned an unreadable response (status ${response.status}).`,
    );
  }
}

export async function bigqueryRequest(
  token: string,
  path: string,
  init: RequestInit = {},
  signal = AbortSignal.timeout(10_000),
) {
  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
    redirect: 'manual',
    signal,
  });
  const body = await readJsonResponse(response, MAX_RESULT_BYTES);
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }) })
      .safeParse(body);
    const reasons = error.success
      ? (error.data.error.errors?.map((entry) => entry.reason) ?? [])
      : [];
    if (reasons.includes('billingTierLimitExceeded') || reasons.includes('resourcesExceeded'))
      throw new DatasourceError(
        'datasource_source_too_large',
        'BigQuery exceeded the query cost or resource limit. Narrow the date range or raise the datasource byte limit.',
      );
    if (response.status === 401 || response.status === 403)
      throw new DatasourceError(
        'datasource_access_denied',
        'Google access was denied. Check table access and permission to run query jobs in the data project, or reconnect Google.',
      );
    if (response.status === 404)
      throw new DatasourceError(
        'datasource_source_not_found',
        'BigQuery project, dataset, table or job not found. Check the location.',
      );
    if (response.status === 400)
      throw new DatasourceError(
        'invalid_query',
        'BigQuery rejected the query. Check field types, partition filter requirements, and the query byte limit.',
      );
    throw new DatasourceError('datasource_connector_failed', 'BigQuery is unavailable.');
  }
  return body;
}

export async function executeBigquery(
  token: string,
  source: { project: string; location: string; maximumBytesBilled: string },
  query: { sql: string; parameters: unknown[] },
  workspaceId: string,
) {
  const jobId = `yresonance_${crypto.randomUUID().replaceAll('-', '')}`;
  const projectPath = `projects/${encodeURIComponent(source.project)}`;
  const jobPath = `${projectPath}/jobs/${jobId}`;
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(35_000);
  let submitted = false;
  try {
    // A known job ID lets us cancel even if the submission response is lost. Never resubmit.
    submitted = true;
    await bigqueryRequest(
      token,
      `${projectPath}/jobs`,
      {
        method: 'POST',
        body: JSON.stringify({
          jobReference: { projectId: source.project, jobId, location: source.location },
          configuration: {
            jobTimeoutMs: '30000',
            labels: { application: 'yresonance' },
            query: {
              query: query.sql,
              useLegacySql: false,
              useQueryCache: true,
              maximumBytesBilled: source.maximumBytesBilled,
              parameterMode: 'POSITIONAL',
              queryParameters: query.parameters.map(parameter),
            },
          },
        }),
      },
      signal,
    );
    const rows: Record<string, unknown>[] = [];
    let fields: z.infer<typeof columnSchema>[] | undefined;
    let pageToken: string | undefined;
    let bytes = 0;
    do {
      const search = new URLSearchParams({
        location: source.location,
        timeoutMs: '1000',
        maxResults: '1000',
      });
      if (pageToken) search.set('pageToken', pageToken);
      const result = resultSchema.parse(
        await bigqueryRequest(token, `${projectPath}/queries/${jobId}?${search}`, {}, signal),
      );
      if (result.errors?.length)
        throw new DatasourceError(
          'invalid_query',
          'BigQuery could not execute the query. Check field types, partition filters, and the datasource byte limit.',
        );
      if (!result.jobComplete) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      fields ??= result.schema?.fields;
      if (!fields)
        throw new DatasourceError(
          'datasource_connector_failed',
          'BigQuery returned no result schema.',
        );
      for (const row of result.rows ?? []) {
        const decoded = Object.fromEntries(
          fields.map((field, index) => [field.name, scalar(row.f[index]?.v, field.type)]),
        );
        bytes += new TextEncoder().encode(JSON.stringify(decoded)).byteLength;
        rows.push(decoded);
        if (rows.length > MAX_RESULT_ROWS || bytes > MAX_RESULT_BYTES)
          throw new DatasourceError(
            'datasource_source_too_large',
            'BigQuery returned too much data. Narrow the date range or widget result limit.',
          );
      }
      pageToken = result.pageToken;
      if (!pageToken) {
        const job = z
          .object({
            statistics: z
              .object({
                query: z
                  .object({
                    totalBytesBilled: z.string().optional(),
                    totalSlotMs: z.string().optional(),
                  })
                  .optional(),
              })
              .optional(),
          })
          .safeParse(
            await bigqueryRequest(
              token,
              `${jobPath}?location=${encodeURIComponent(source.location)}`,
              {},
              signal,
            ).catch(() => undefined),
          );
        const statistics = job.success ? job.data.statistics?.query : undefined;
        console.info('yresonance.bigquery_query', {
          workspaceId,
          jobId,
          durationMs: Date.now() - startedAt,
          bytesProcessed: result.totalBytesProcessed,
          bytesBilled: statistics?.totalBytesBilled,
          slotMs: statistics?.totalSlotMs,
          cacheHit: result.cacheHit,
          rowCount: rows.length,
        });
        recordProductMetric('bigquery_query', {
          index: workspaceId,
          labels: [result.cacheHit ? 'cached' : 'executed'],
          numbers: [
            Date.now() - startedAt,
            Number(result.totalBytesProcessed ?? 0),
            Number(statistics?.totalBytesBilled ?? 0),
            rows.length,
          ],
        });
        return rows;
      }
    } while (!signal.aborted);
    throw new DatasourceError('datasource_connector_failed', 'BigQuery timed out.');
  } catch (error) {
    if (submitted)
      await bigqueryRequest(
        token,
        `${jobPath}/cancel?location=${encodeURIComponent(source.location)}`,
        { method: 'POST' },
      ).catch(() => undefined);
    console.warn('yresonance.bigquery_query', {
      workspaceId,
      jobId,
      result: 'failed',
      durationMs: Date.now() - startedAt,
      code: error instanceof DatasourceError ? error.code : 'transport_error',
    });
    if (error instanceof DatasourceError) throw error;
    throw new DatasourceError(
      'datasource_connector_failed',
      'BigQuery did not complete the query.',
    );
  }
}

function parameter(value: unknown) {
  const data = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]).parse(value);
  return {
    parameterType: {
      type:
        typeof data === 'number'
          ? Number.isInteger(data)
            ? 'INT64'
            : 'FLOAT64'
          : typeof data === 'boolean'
            ? 'BOOL'
            : 'STRING',
    },
    parameterValue: { value: data === null ? null : String(data) },
  };
}
export function scalar(value: unknown, type: string): unknown {
  if (value === undefined || value === null) return null;
  const text = z.union([z.string(), z.boolean(), z.number()]).parse(value);
  if (type === 'INTEGER' || type === 'INT64') return String(text);
  if (type === 'NUMERIC' || type === 'BIGNUMERIC' || type === 'DECIMAL' || type === 'BIGDECIMAL')
    return String(text);
  if (type === 'FLOAT' || type === 'FLOAT64') {
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  if (type === 'BOOLEAN' || type === 'BOOL') return text === true || text === 'true';
  if (type === 'TIMESTAMP') return new Date(Number(text) * 1000).toISOString();
  return text;
}
