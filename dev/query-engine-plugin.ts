import { allowDevRequest } from './request-guard.ts';
import { BodyTooLargeError } from '../src/http/body.ts';
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

        if (!allowDevRequest(request, response, true)) return;
        const controller = new AbortController();
        response.on('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.byteLength;
            if (size > 1024 * 1024) throw new BodyTooLargeError();
            chunks.push(bytes);
          }
          const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const deadlineHeader = request.headers['x-yresonance-query-deadline'];
          const deadline = Number(
            Array.isArray(deadlineHeader) ? deadlineHeader[0] : deadlineHeader,
          );
          const result = await executeQuery(input, {
            queryId: crypto.randomUUID(),
            signal: controller.signal,
            deadlineAt: Number.isFinite(deadline) ? deadline : undefined,
          });
          response.end(
            JSON.stringify({
              ok: true,
              ...result,
            }),
          );
        } catch (error) {
          response.statusCode = error instanceof BodyTooLargeError ? 413 : 400;
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
