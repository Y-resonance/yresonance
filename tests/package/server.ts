// Serves the built app with Bun: static client files first, everything else through the app.
import { join } from 'node:path';
import app from './dist/server/server.js';

const client = join(import.meta.dir, 'dist/client');

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const file = Bun.file(join(client, pathname));
    if (pathname !== '/' && (await file.exists())) return new Response(file);
    return app.fetch(request);
  },
});
console.log(`yresonance listening on ${server.url}`);
