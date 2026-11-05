import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PostHog } from 'posthog-node';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { waitUntil } from 'cloudflare:workers';
import type { ApiRequest } from '#/api/contracts';
import type { WidgetDefinition } from '#/domain/schema';
import { markdownFeatures } from '#/domain/text-content';
import { analyticsConfig } from './config.server';
import { sanitizeAnalyticsProperties } from './config';
import { appearanceFieldNames } from '#/domain/appearance';

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
    // Autosaves would otherwise inflate `updateWidget` counts as if each were a deliberate edit.
    ...(request.headers.get('X-YRESONANCE-TRIGGER') === 'autosave' ? { trigger: 'autosave' } : {}),
    environment: config.environment,
    workspace_id: orgId ?? undefined,
    $session_id: sessionId,
    ...(input && 'dashboardId' in input ? { dashboard_id: input.dashboardId } : {}),
    ...(input && 'widgetId' in input ? { widget_id: input.widgetId } : {}),
    ...(input && 'dataSourceId' in input ? { datasource_id: input.dataSourceId } : {}),
    ...(input && 'definition' in input ? { widget_type: input.definition.type } : {}),
    // Shows how many image widgets stay placeholders and how often the optional title is used.
    ...(input && 'definition' in input && input.definition.type === 'image'
      ? {
          image_has_asset: Boolean(input.definition.assetId),
          image_has_title: Boolean(input.definition.title),
        }
      : {}),
    ...(input?.action === 'moveWidget' && input.stacking
      ? { widget_stacking: input.stacking }
      : {}),
    // Agents restack through updateLayout entries, so count those as well.
    ...(input?.action === 'updateLayout'
      ? { widget_restacks: input.placements.filter((entry) => entry.stacking).length }
      : {}),
    ...(input?.action === 'registerDatasource'
      ? { datasource_provider: input.provider ?? input.backend ?? 'duckdb-file' }
      : {}),
    // Which styling options people use: theme fields set on save, and per-widget overrides.
    ...(input?.action === 'updateDashboard' && input.theme
      ? { theme_fields: appearanceFieldNames(input.theme) }
      : {}),
    ...((input?.action === 'addWidget' || input?.action === 'updateWidget') &&
    input.definition.appearance
      ? { appearance_fields: appearanceFieldNames(input.definition.appearance) }
      : {}),
    ...(input?.action === 'addWidget' || input?.action === 'updateWidget'
      ? widgetProperties(input.definition)
      : {}),
  };
  if (distinctId) {
    client.capture({ distinctId, event: 'product_action', properties });
  }
  if (status >= 500 && error)
    client.captureException(analyticsException(error), distinctId, properties);

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

// Widget writes record their type; text widgets also whether they use links or formatting, to
// see whether rich text gets adopted. Never the text itself.
function widgetProperties(definition: WidgetDefinition) {
  const style =
    definition.type === 'text'
      ? definition.textStyle
      : 'titleStyle' in definition
        ? definition.titleStyle
        : undefined;
  const styles = style ? { text_style_fields: appearanceFieldNames(style) } : {};
  if (definition.type !== 'text') return { widget_type: definition.type, ...styles };
  const features = markdownFeatures(definition.content.document);
  return {
    widget_type: definition.type,
    ...styles,
    text_has_links: features.hasLinks,
    text_has_formatting: features.hasFormatting,
  };
}

// Drizzle embeds SQL and bound values in the message. Keep stack locations, not parameters or causes.
function analyticsException(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error instanceof DrizzleQueryError) {
    const safe = new Error('Database query failed');
    safe.name = 'DrizzleQueryError';
    safe.stack = error.stack?.replace(error.message, safe.message);
    return safe;
  }
  if (error.cause instanceof Error) {
    const safe = new Error(error.message, { cause: analyticsException(error.cause) });
    safe.name = error.name;
    safe.stack = error.stack;
    return safe;
  }
  return error;
}
