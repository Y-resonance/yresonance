import { json } from 'node:stream/consumers';
import type { Plugin } from 'vite';
import { executeQueryEngineRequest } from '../container/query-engine.ts';
import { createQueryExecutor } from '../container/query-executor.ts';

const route = '/__query-engine';

export function queryEnginePlugin(): Plugin {
  const executeQuery = createQueryExecutor(executeQueryEngineRequest);
  return {
    name: 'yresonance-query-engine',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname !== route) return next();

        response.setHeader('content-type', 'application/json');
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.setHeader('allow', 'POST');
          response.end(JSON.stringify({ ok: false, error: 'Method not allowed.' }));
          return;
        }

        try {
          const input: unknown = await json(request);
          const deadlineHeader = request.headers['x-yresonance-query-deadline'];
          const deadline = Number(
            Array.isArray(deadlineHeader) ? deadlineHeader[0] : deadlineHeader,
          );
          const result = await executeQuery(input, {
            queryId: crypto.randomUUID(),
            deadlineAt: Number.isFinite(deadline) ? deadline : undefined,
          });
          response.end(
            JSON.stringify({
              ok: true,
              ...result,
            }),
          );
        } catch (error) {
          response.statusCode = 400;
          response.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : 'Unknown query engine error.',
            }),
          );
        }
      });
    },
  };
}
