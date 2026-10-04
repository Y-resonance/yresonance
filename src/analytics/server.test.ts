import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackApiRequest } from './server';

const state = vi.hoisted(() => ({
  env: {
    POSTHOG_ENABLED: 'true',
    POSTHOG_PROJECT_TOKEN: 'phc_test',
    POSTHOG_HOST: '',
    APP_ENV: 'test',
  },
  pending: [] as Promise<unknown>[],
}));
vi.mock('cloudflare:workers', () => ({
  env: state.env,
  waitUntil: (promise: Promise<unknown>) => state.pending.push(promise),
}));

const requests: Array<{ url: string; body: string; authorization?: string }> = [];
const outage = new DrizzleQueryError(
  'select * from share_links where token = ?',
  ['secret-share-token', 'Confidential Client Report', 'sum(cost)/impressions'],
  new Error('D1 unavailable: secret-share-token'),
);
outage.stack = `${outage.name}: ${outage.message}\n    at executeQuery (/app/dist/server/index.js:23:7)`;
const server = createServer(async (request, response) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const body = (
    request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes
  ).toString();
  requests.push({ url: request.url ?? '', body, authorization: request.headers.authorization });
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{}');
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
  state.env.POSTHOG_HOST = `http://127.0.0.1:${address.port}`;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
beforeEach(() => {
  requests.length = 0;
  state.pending.length = 0;
  state.env.POSTHOG_ENABLED = 'true';
});

describe('server analytics delivery', () => {
  it.each([200, 400, 500])(
    'exports correlated events and OTLP logs for status %s without request content',
    async (status) => {
      trackApiRequest({
        request: new Request('https://yresonance.com/api/yresonance', {
          headers: {
            'X-POSTHOG-DISTINCT-ID': 'untrusted-browser-user',
            'X-POSTHOG-SESSION-ID': 'session_123',
            'X-YRESONANCE-SOURCE': 'webmcp',
          },
        }),
        input: {
          action: 'getDashboard',
          dashboardId: 'dash_123',
          shareToken: 'secret-share-token',
        },
        userId: 'user_authenticated',
        orgId: 'org_123',
        status,
        durationMs: 42,
        ...(status === 500 ? { error: outage, errorCode: 'internal_error' } : {}),
      });
      await Promise.all(state.pending);

      const eventRequests = requests.filter((request) => request.url.startsWith('/batch/'));
      const events = eventRequests.flatMap(
        (request) =>
          z
            .object({
              batch: z.array(
                z.object({
                  event: z.string(),
                  distinct_id: z.string(),
                  properties: z.record(z.string(), z.unknown()),
                }),
              ),
            })
            .parse(JSON.parse(request.body)).batch,
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event: 'product_action',
          distinct_id: 'user_authenticated',
          properties: expect.objectContaining({
            $session_id: 'session_123',
            workspace_id: 'org_123',
            action: 'getDashboard',
            source: 'webmcp',
            result: status === 200 ? 'success' : 'error',
          }),
        }),
      );
      const logRequest = requests.find((request) => request.url === '/i/v1/logs');
      expect(logRequest?.authorization).toBe('Bearer phc_test');
      const logs = JSON.parse(logRequest!.body).resourceLogs[0].scopeLogs[0].logRecords;
      expect(logs[0].body.stringValue).toBe('api_request_completed');
      expect(logs[0].severityText).toBe(
        status === 500 ? 'ERROR' : status === 400 ? 'WARN' : 'INFO',
      );
      expect(logRequest!.body).toContain('session_123');
      expect(JSON.stringify(requests)).not.toContain('secret-share-token');
      expect(JSON.stringify(requests)).not.toContain('Confidential Client Report');
      expect(JSON.stringify(requests)).not.toContain('sum(cost)/impressions');
      const expectedException = expect.objectContaining({
        properties: expect.objectContaining({
          $exception_list: expect.arrayContaining([
            expect.objectContaining({
              stacktrace: expect.objectContaining({
                frames: expect.arrayContaining([
                  expect.objectContaining({ function: 'executeQuery' }),
                ]),
              }),
            }),
          ]),
        }),
      });
      expect(events.filter((event) => event.event === '$exception')).toEqual(
        status === 500 ? [expectedException] : [],
      );
      expect(JSON.stringify(requests)).not.toContain('untrusted-browser-user');
    },
  );

  it('does not send telemetry when disabled', async () => {
    state.env.POSTHOG_ENABLED = 'false';
    trackApiRequest({
      request: new Request('https://yresonance.com/api/yresonance'),
      status: 200,
      durationMs: 1,
    });
    await Promise.all(state.pending);
    expect(requests).toEqual([]);
  });
});
