import { settings } from '#/platform/settings';
import { createFileRoute } from '@tanstack/react-router';
import type {} from '@tanstack/react-start';
import { handleExternalFileRequest } from '#/data/external-file';

export const Route = createFileRoute('/api/connector-file/$token')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleExternalFileRequest(request, params.token, settings()),
      HEAD: ({ request, params }) => handleExternalFileRequest(request, params.token, settings()),
    },
  },
});
