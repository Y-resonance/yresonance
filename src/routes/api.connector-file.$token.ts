import { createFileRoute } from '@tanstack/react-router';
import type {} from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import { handleExternalFileRequest } from '#/data/external-file';

export const Route = createFileRoute('/api/connector-file/$token')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleExternalFileRequest(request, params.token, env),
      HEAD: ({ request, params }) => handleExternalFileRequest(request, params.token, env),
    },
  },
});
