import { BodyTooLargeError, readRequestBytes } from '#/http/body';
import { ZodError } from 'zod';
import { createFileRoute } from '@tanstack/react-router';
import type {} from '@tanstack/react-start';
import { apiRequestSchema, type ApiResponse } from '#/api/contracts';
import { ApiError } from '#/server/errors';
import { executeRequest } from '#/server/service.server';
import { auth } from '@clerk/tanstack-react-start/server';
import { trackApiRequest } from '#/analytics/server';
import type { ApiRequest } from '#/api/contracts';

export const Route = createFileRoute('/api/yresonance')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        let input: ApiRequest | undefined;
        // Auth identity wins over the browser's correlation header.
        let session: Awaited<ReturnType<typeof auth>> | undefined;
        try {
          const origin = request.headers.get('origin');
          if (
            (origin && origin !== new URL(request.url).origin) ||
            request.headers.get('sec-fetch-site') === 'cross-site'
          )
            throw new ApiError(
              403,
              'cross_origin_request',
              'Cross-origin API requests are not allowed.',
            );
          if (
            request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
            'application/json'
          )
            throw new ApiError(415, 'unsupported_media_type', 'Use application/json.');
          session = await auth();
          let payload: unknown;
          try {
            payload = JSON.parse(
              new TextDecoder().decode(
                (await readRequestBytes(request, 1024 * 1024)) ?? new Uint8Array(),
              ),
            );
          } catch (error) {
            if (error instanceof BodyTooLargeError)
              throw new ApiError(413, 'request_too_large', error.message);
            if (error instanceof SyntaxError)
              throw new ApiError(400, 'invalid_request', 'The request must contain valid JSON.');
            throw error;
          }
          input = apiRequestSchema.parse(payload);
          const body: ApiResponse = { ok: true, data: await executeRequest(input) };
          trackApiRequest({
            request,
            input,
            status: 200,
            durationMs: Date.now() - startedAt,
            userId: session.userId,
            orgId: session.orgId,
          });
          return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
        } catch (error) {
          const status =
            error instanceof ApiError ? error.status : error instanceof ZodError ? 400 : 500;
          const body: ApiResponse = {
            ok: false,
            error: {
              code:
                error instanceof ApiError
                  ? error.code
                  : error instanceof ZodError
                    ? 'invalid_request'
                    : 'internal_error',
              message:
                error instanceof ApiError
                  ? error.message
                  : error instanceof ZodError
                    ? 'The request is invalid.'
                    : 'yresonance could not complete the request.',
              issues:
                error instanceof ZodError
                  ? error.issues
                      .slice(0, 20)
                      .map(({ code, path, message }) => ({ code, path, message }))
                  : error instanceof ApiError
                    ? error.issues
                    : undefined,
            },
          };
          if (!(error instanceof ApiError) && !(error instanceof ZodError))
            console.error(
              JSON.stringify({
                event: 'api_request_failed',
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          trackApiRequest({
            request,
            input,
            status,
            durationMs: Date.now() - startedAt,
            error,
            errorCode: body.error.code,
            userId: session?.userId,
            orgId: session?.orgId,
          });
          return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
        }
      },
    },
  },
});
