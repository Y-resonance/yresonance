import { createFileRoute } from '@tanstack/react-router';
import { completeGoogleConnection } from '#/data/google-oauth.server';
import { ApiError } from '#/server/errors';

export const Route = createFileRoute('/api/oauth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await completeGoogleConnection(request);
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof ApiError
                  ? error.message
                  : 'Google connection failed. Start connecting again.',
            },
            {
              status: error instanceof ApiError ? error.status : 500,
              headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
            },
          );
        }
      },
    },
  },
});
