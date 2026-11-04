import { createFileRoute } from '@tanstack/react-router';
import type {} from '@tanstack/react-start';
import { ApiError } from '#/server/errors';
import { uploadImageAsset } from '#/server/image-assets.server';

// Editors upload dashboard images here with the raw file as the body and `?name=<file name>`.
export const Route = createFileRoute('/api/dashboards/$dashboardId/assets')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        try {
          const origin = request.headers.get('origin');
          if (
            (origin && origin !== new URL(request.url).origin) ||
            request.headers.get('sec-fetch-site') === 'cross-site'
          )
            throw new ApiError(
              403,
              'cross_origin_request',
              'Cross-origin uploads are not allowed.',
            );
          const asset = await uploadImageAsset(request, params.dashboardId);
          return Response.json(asset, { status: 201, headers: { 'cache-control': 'no-store' } });
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
