import { executeQueryEngineRequest } from './query-engine.ts';
import { createQueryExecutor } from './query-executor.ts';

const executeQuery = createQueryExecutor(executeQueryEngineRequest);

const server = Bun.serve({
  port: 8080,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ready') return Response.json({ ok: true });
    if (url.pathname !== '/query' || request.method !== 'POST')
      return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });

    try {
      const queryId = request.headers.get('x-yresonance-query-id') ?? crypto.randomUUID();
      const result = await executeQuery(await request.json(), {
        queryId,
        signal: request.signal,
        deadlineAt: queryDeadline(request.headers.get('x-yresonance-query-deadline')),
      });
      return Response.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown query engine error.';
      console.error('Query engine request failed', { message });
      return Response.json({ ok: false, error: message }, { status: timeoutStatus(error) });
    }
  },
});

console.log(`Query engine listening on port ${server.port}`);

function timeoutStatus(error: unknown) {
  return error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)
    ? 408
    : 400;
}

function queryDeadline(value: string | null) {
  if (value === null) return undefined;
  const deadline = Number(value);
  return Number.isFinite(deadline) ? deadline : undefined;
}
