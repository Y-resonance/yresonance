import { ZodError } from 'zod';
import { createFileRoute } from '@tanstack/react-router';
import type {} from '@tanstack/react-start';
import { apiRequestSchema, type ApiResponse } from '#/api/contracts';
import { ApiError } from '#/server/errors';
import { executeRequest } from '#/server/service.server';

export const Route = createFileRoute('/api/yresonance')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const input = apiRequestSchema.parse(await request.json());
          const body: ApiResponse = { ok: true, data: await executeRequest(input) };
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
              issues: error instanceof ZodError ? error.issues : undefined,
            },
          };
          if (!(error instanceof ApiError) && !(error instanceof ZodError))
            console.error(
              JSON.stringify({
                event: 'api_request_failed',
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
        }
      },
    },
  },
});
