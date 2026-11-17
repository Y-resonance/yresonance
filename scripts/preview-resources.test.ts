import { afterEach, expect, test, vi } from 'vitest';

// Exercise the CLI's real HTTP adapter; stop at the Postgres boundary before any database access.
vi.mock('./postgres-preview', () => ({
  managePreviewPostgres: (
    _action: string,
    _branch: string,
    api: (path: string) => Promise<unknown>,
  ) => api('/hyperdrive/configs'),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('a non-JSON Cloudflare access denial preserves its HTTP status', async () => {
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('<html>access denied</html>', { status: 403 })),
  );
  const original = process.argv;
  process.argv = ['bun', 'scripts/preview-resources.ts', 'diagnose', 'preview-diagnostics'];
  try {
    await expect(import('./preview-resources')).rejects.toMatchObject({
      status: 403,
      message: 'Cloudflare GET /hyperdrive/configs failed with HTTP 403',
    });
  } finally {
    process.argv = original;
  }
});
