import { createFileRoute } from '@tanstack/react-router';
import type {} from '@tanstack/react-start';
import { ApiError } from '#/server/errors';
import { serveImageAsset } from '#/server/image-assets.server';

// `?w=<width>` asks for a resized variant, `?share=<token>` authorizes unlisted link viewers.
export const Route = createFileRoute('/api/dashboards/$dashboardId/assets/$assetId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          return await serveImageAsset(request, params.dashboardId, params.assetId);
        } catch (error) {
          if (error instanceof ApiError)
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.status, headers: { 'cache-control': 'no-store' } },
            );
          throw error;
        }
      },
    },
  },
});
