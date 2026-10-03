import { executeQueryEngineRequest } from './query-engine.ts';

export interface QueryExecutionMetrics {
  queryDurationMs: number;
  queueDurationMs: number;
  resultBytes: number;
}

interface QueryExecutionOptions {
  queryId: string;
  signal?: AbortSignal;
  deadlineAt?: number;
}

/** Keeps DuckDB instances from competing for the memory assigned to one container. */
export function createQueryExecutor(
  execute: (input: unknown) => Promise<unknown> = executeQueryEngineRequest,
) {
  let tail = Promise.resolve();
  let activeQueries = 0;
  let queuedQueries = 0;

  return function enqueue(input: unknown, options: QueryExecutionOptions) {
    const queuedAt = performance.now();
    queuedQueries += 1;
    console.info('yresonance.query_engine_queue', {
      queryId: options.queryId,
      state: 'queued',
      activeQueries,
      queuedQueries,
    });

    const result = tail.then(async () => {
      queuedQueries -= 1;
      try {
        throwIfAborted(options.signal, options.deadlineAt);
      } catch (error) {
        console.info('yresonance.query_engine_queue', {
          queryId: options.queryId,
          state: 'cancelled',
          activeQueries,
          queuedQueries,
          queueDurationMs: performance.now() - queuedAt,
        });
        throw error;
      }
      activeQueries += 1;
      const startedAt = performance.now();
      const queueDurationMs = startedAt - queuedAt;
      console.info('yresonance.query_engine_queue', {
        queryId: options.queryId,
        state: 'started',
        activeQueries,
        queuedQueries,
        queueDurationMs,
      });
      try {
        const data = await execute(input);
        const resultBytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
        const queryDurationMs = performance.now() - startedAt;
        console.info('yresonance.query_engine_queue', {
          queryId: options.queryId,
          state: 'completed',
          activeQueries,
          queuedQueries,
          queueDurationMs,
          queryDurationMs,
          resultBytes,
        });
        return {
          data,
          metrics: { queryDurationMs, queueDurationMs, resultBytes },
        };
      } catch (error) {
        console.warn('yresonance.query_engine_queue', {
          queryId: options.queryId,
          state: 'failed',
          activeQueries,
          queuedQueries,
          queueDurationMs,
          queryDurationMs: performance.now() - startedAt,
          error: error instanceof Error ? error.message : 'Unknown query engine error.',
        });
        throw error;
      } finally {
        activeQueries -= 1;
      }
    });

    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

function throwIfAborted(signal: AbortSignal | undefined, deadlineAt: number | undefined) {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt)
    throw new DOMException('The query request timed out while waiting to run.', 'TimeoutError');
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The query request was cancelled.', 'AbortError');
}
