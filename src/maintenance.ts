// Runs before routing, analytics, authentication or database access. Keep /ready available
// so the new deployment can be checked before traffic is reopened.
export function maintenanceResponse(request: Request, mode: string | undefined) {
  if (!mode || mode === '0' || mode === 'false' || new URL(request.url).pathname === '/ready')
    return undefined;
  return new Response(
    request.method === 'HEAD'
      ? null
      : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance | yresonance</title><style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;margin:10vh auto;padding:0 24px;max-width:36rem}h1{font-size:2rem}</style></head><body><h1>We’ll be back shortly</h1><p>yresonance is undergoing maintenance. Please try again shortly.</p></body></html>`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '60',
      },
    },
  );
}
