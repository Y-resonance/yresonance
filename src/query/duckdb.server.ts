import { getContainer } from '@cloudflare/containers';
import { env } from 'cloudflare:workers';
import { finishQueryReadBudget } from '#/data/internal-r2';
import { resolveDataSource } from '#/data/source.server';
import type {
  QueryEngineMetrics,
  QueryEngineRequest,
  QueryEngineResponse,
} from './engine-contract';
import type { DataSourceRecord } from './types';
import { safeQueryMessage } from './errors';
import { recordProductMetric } from '#/observability';

const QUERY_ENGINE_REQUEST_TIMEOUT_MS = 40_000;

export class QueryEngineError extends Error {
  constructor(
    public readonly kind: 'invalid-query' | 'request-failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export async function runPreparedQuery<T extends Record<string, unknown>>(
  dataSource: DataSourceRecord,
  compile: (sourceSql: string) => { sql: string; parameters: unknown[] },
) {
  const queryId = crypto.randomUUID();
  const source = await resolveDataSource(dataSource, queryId);
  const startedAt = Date.now();
  let result;
  let scannedBytes = 0;
  try {
    const query = compile(source.sql);
    result = await queryEngineRequest<T[]>(dataSource.workspaceId, queryId, {
      operation: 'query',
      sql: query.sql,
      parameters: query.parameters,
    });
  } catch (error) {
    console.warn('yresonance.query_execution', {
      backend: 'duckdb',
      workspaceId: dataSource.workspaceId,
      queryId,
      outcome: 'failure',
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    scannedBytes = await finishSourceRead(source.queryBudgetId, queryId, dataSource.workspaceId);
  }
  console.info('yresonance.query_execution', {
    queryId,
    backend: 'duckdb',
    outcome: 'success',
    durationMs: Date.now() - startedAt,
    workspaceId: dataSource.workspaceId,
    sourceBytes: source.sourceBytes,
    scannedBytes,
    objectCount: source.objectKeys.length,
    ...result.metrics,
  });
  recordProductMetric('query_execution', {
    labels: ['success'],
    numbers: [
      result.metrics.containerStartMs,
      result.metrics.queryDurationMs,
      scannedBytes,
      result.metrics.resultBytes,
      result.metrics.queueDurationMs,
    ],
    index: dataSource.workspaceId,
  });
  return result.data;
}

export async function describeDataSource(dataSource: DataSourceRecord) {
  const queryId = crypto.randomUUID();
  const source = await resolveDataSource(dataSource, queryId);
  try {
    const result = await queryEngineRequest<{
      description: Array<{ column_name: string; column_type: string }>;
      samples: Record<string, unknown>[];
    }>(dataSource.workspaceId, queryId, {
      operation: 'describeSource',
      sourceSql: source.sql,
    });
    return result.data;
  } finally {
    await finishSourceRead(source.queryBudgetId, queryId, dataSource.workspaceId);
  }
}

export async function ingestCsv(
  workspaceId: string,
  tokenId: string,
  sourceUrl: string,
  destinationUrl: string,
) {
  const result = await queryEngineRequest<{ size: number; etag: string | null }>(
    workspaceId,
    tokenId,
    { operation: 'ingestCsv', sourceUrl, destinationUrl },
  );
  console.info('yresonance.datasource_ingestion', {
    workspaceId,
    tokenId,
    outputBytes: result.data.size,
    ...result.metrics,
  });
  return result.data;
}

async function queryEngineRequest<T>(
  workspaceId: string,
  queryId: string,
  body: QueryEngineRequest,
) {
  const local = !env.DATA_SOURCE_BASE_URL.startsWith('r2://');
  const deadlineAt = Date.now() + QUERY_ENGINE_REQUEST_TIMEOUT_MS;
  const request = new Request(
    local ? new URL('/__query-engine', env.DATA_SOURCE_BASE_URL) : 'http://query-engine/query',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yresonance-query-id': queryId,
        'x-yresonance-query-deadline': String(deadlineAt),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(QUERY_ENGINE_REQUEST_TIMEOUT_MS),
    },
  );
  const startedAt = performance.now();
  let response: Response;
  let responseText: string;
  try {
    response = local
      ? await fetch(request)
      : await getContainer(env.QUERY_ENGINE, workspaceId).fetch(request);
    responseText = await response.text();
  } catch (error) {
    const totalDurationMs = performance.now() - startedAt;
    const timedOut = request.signal.aborted;
    console.warn('yresonance.query_failure', {
      queryId,
      workspaceId,
      totalDurationMs,
      error: timedOut ? 'Query engine request timed out.' : 'Query engine request failed.',
    });
    recordProductMetric('query_execution', {
      labels: [timedOut ? 'timeout' : 'error'],
      numbers: [totalDurationMs],
      index: workspaceId,
    });
    throw new QueryEngineError(
      'request-failed',
      timedOut
        ? 'The query engine did not respond within 40 seconds.'
        : 'The query engine request failed.',
      { cause: error },
    );
  }
  const totalDurationMs = performance.now() - startedAt;
  let result: QueryEngineResponse<T>;
  try {
    result = JSON.parse(responseText) as QueryEngineResponse<T>;
  } catch {
    throw new QueryEngineError(
      'request-failed',
      responseText || `Query engine returned HTTP ${response.status}.`,
    );
  }
  if (!response.ok || !result.ok) {
    console.warn('yresonance.query_failure', {
      queryId,
      workspaceId,
      totalDurationMs,
      error: result.ok ? `HTTP ${response.status}` : safeQueryMessage(result.error),
    });
    recordProductMetric('query_execution', {
      labels: ['error'],
      numbers: [totalDurationMs],
      index: workspaceId,
    });
    if (!result.ok && response.status === 400)
      throw new QueryEngineError('invalid-query', safeQueryMessage(result.error));
    throw new QueryEngineError(
      'request-failed',
      result.ok ? `Query engine returned HTTP ${response.status}.` : result.error,
    );
  }
  return {
    data: result.data,
    metrics: queryMetrics(result.metrics, totalDurationMs),
  };
}

function queryMetrics(metrics: QueryEngineMetrics, totalDurationMs: number) {
  const queueDurationMs = metrics.queueDurationMs ?? 0;
  return {
    queryDurationMs: metrics.queryDurationMs,
    queueDurationMs,
    containerStartMs: Math.max(0, totalDurationMs - metrics.queryDurationMs - queueDurationMs),
    resultBytes: metrics.resultBytes,
  };
}

async function finishSourceRead(
  budgetId: string | undefined,
  queryId: string,
  workspaceId: string,
) {
  if (!budgetId) return 0;
  try {
    const scannedBytes = await finishQueryReadBudget(budgetId, env);
    console.info('yresonance.query_scanned_bytes', { queryId, workspaceId, scannedBytes });
    recordProductMetric('query_scanned_bytes', {
      numbers: [scannedBytes],
      index: workspaceId,
    });
    return scannedBytes;
  } catch (error) {
    console.warn('yresonance.query_budget_cleanup_failed', {
      queryId,
      workspaceId,
      error: error instanceof Error ? error.message : 'Unknown cleanup error.',
    });
    return 0;
  }
}
