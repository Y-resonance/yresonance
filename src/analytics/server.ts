import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PostHog } from 'posthog-node';
import { waitUntil } from 'cloudflare:workers';
import type { ApiRequest } from '#/api/contracts';
import { analyticsConfig } from './config.server';
import { sanitizeAnalyticsProperties } from './config';

export function trackApiRequest(options: Parameters<typeof exportApiRequest>[0]) {
  try {
    exportApiRequest(options);
  } catch {
    console.warn('yresonance.telemetry_export_failed');
  }
}

function exportApiRequest({
  request,
  input,
  status,
  durationMs,
  error,
  errorCode,
  userId,
  orgId,
}: {
  request: Request;
  input?: ApiRequest;
  status: number;
  durationMs: number;
  error?: unknown;
  errorCode?: string;
  userId?: string | null;
  orgId?: string | null;
}) {
  const config = analyticsConfig();
  if (!config) return;
  // Keep SDK queues request-local: Workers cannot reuse another request's in-flight I/O.
  const client = new PostHog(config.token, {
    host: config.host,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 2000,
    fetchRetryCount: 0,
    disableGeoip: true,
    enableExceptionAutocapture: false,
    before_send: (event) =>
      event
        ? {
            ...event,
            properties: sanitizeAnalyticsProperties(event.properties ?? {}),
          }
        : event,
  });
  const distinctId = userId ?? request.headers.get('X-POSTHOG-DISTINCT-ID')?.slice(0, 200);
  const sessionId = request.headers.get('X-POSTHOG-SESSION-ID')?.slice(0, 200);
  const properties = {
    action:
      input?.action ?? (errorCode === 'invalid_request' ? 'invalid_request' : 'server_request'),
    result: status < 400 ? 'success' : 'error',
    status,
    duration_ms: durationMs,
    error_code: errorCode,
    source: request.headers.get('X-YRESONANCE-SOURCE') === 'webmcp' ? 'webmcp' : 'gui',
    environment: config.environment,
    workspace_id: orgId ?? undefined,
    $session_id: sessionId,
    ...(input && 'dashboardId' in input ? { dashboard_id: input.dashboardId } : {}),
    ...(input && 'widgetId' in input ? { widget_id: input.widgetId } : {}),
    ...(input && 'dataSourceId' in input ? { datasource_id: input.dataSourceId } : {}),
  };
  if (distinctId) {
    client.capture({ distinctId, event: 'product_action', properties });
  }
  if (status >= 500 && error) client.captureException(error, distinctId, properties);

  const logs = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': 'yresonance-api',
      'deployment.environment': config.environment,
    }),
    processors: [
      new SimpleLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${config.host}/i/v1/logs`,
          headers: { Authorization: `Bearer ${config.token}` },
          timeoutMillis: 2000,
        }),
      }),
    ],
  });
  logs.getLogger('yresonance').emit({
    body: 'api_request_completed',
    severityText: status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO',
    severityNumber: status >= 500 ? 17 : status >= 400 ? 13 : 9,
    attributes: { ...properties, distinct_id: distinctId, session_id: sessionId },
  });

  // Await exports inside waitUntil so analytics never delay or fail the user's request.
  waitUntil(
    Promise.allSettled([client.shutdown(), logs.shutdown()]).then((results) => {
      if (results.some((result) => result.status === 'rejected'))
        console.warn('yresonance.telemetry_export_failed');
    }),
  );
}
