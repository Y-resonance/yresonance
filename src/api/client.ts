import { apiResponseSchema, type ApiRequest } from './contracts';
import { analyticsHeaders, browserAnalytics } from '#/analytics/browser';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function callApi<T>(
  request: ApiRequest,
  options: { signal?: AbortSignal; source?: 'gui' | 'webmcp' } = {},
): Promise<T> {
  try {
    const response = await fetch('/api/yresonance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...analyticsHeaders(),
        'X-YRESONANCE-SOURCE': options.source ?? 'gui',
      },
      body: JSON.stringify(request),
      signal: options.signal,
    });
    const body = apiResponseSchema.parse(await response.json());
    if (!body.ok) {
      browserAnalytics()?.logger.warn('api_request_failed', {
        action: request.action,
        error_code: body.error.code,
        status: response.status,
      });
      throw new ApiClientError(body.error.code, body.error.message);
    }
    return body.data as T;
  } catch (error) {
    if (!(error instanceof ApiClientError) && !options.signal?.aborted) {
      browserAnalytics()?.captureException(error, { action: request.action });
      browserAnalytics()?.logger.error('api_transport_failed', { action: request.action });
    }
    throw error;
  }
}
