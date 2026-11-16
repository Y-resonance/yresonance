import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));
import {
  browserUploadPath,
  capabilityUrl,
  createR2Capability,
  handleBrowserUploadRequest,
  handleInternalR2Request,
  INTERNAL_R2_HOST,
  verifyR2Capability,
} from './internal-r2';

describe('internal R2 capabilities', () => {
  it('binds query reads to one object and query id', async () => {
    const token = await createR2Capability(
      {
        kind: 'read',
        key: 'ws/acme/report.parquet',
        queryId: 'query-1',
        expiresAt: 2_000,
      },
      'secret',
    );
    await expect(verifyR2Capability(token, 'secret', 1_000_000)).resolves.toEqual({
      kind: 'read',
      key: 'ws/acme/report.parquet',
      queryId: 'query-1',
      expiresAt: 2_000,
    });
    await expect(verifyR2Capability(token, 'other-secret', 1_000_000)).resolves.toBeUndefined();
    expect(capabilityUrl(token)).toContain(`http://${INTERNAL_R2_HOST}/capability/`);
  });

  it('expires capabilities and rejects payload tampering', async () => {
    const token = await createR2Capability(
      {
        kind: 'read',
        key: 'ws/acme/upload.parquet',
        queryId: 'query-1',
        expiresAt: 2_000,
      },
      'secret',
    );
    await expect(verifyR2Capability(token, 'secret', 2_001_000)).resolves.toBeUndefined();
    await expect(verifyR2Capability(`${token}x`, 'secret', 1_000_000)).resolves.toBeUndefined();
  });

  it('rejects browser upload keys outside the authorized workspace', async () => {
    const path = browserUploadPath('ws/other/upload.csv');
    const response = await handleBrowserUploadRequest(
      new Request(`https://yresonance.test${path}`, {
        method: 'PUT',
        headers: { 'content-length': '4' },
        body: 'data',
      }),
      path.slice('/api/datasource-upload/'.length),
      {} as Cloudflare.Env,
      { userId: 'user-1', workspaceId: 'workspace-1', workspacePrefix: 'ws/acme/' },
    );

    expect(response.status).toBe(403);
  });

  it('keeps query capabilities read-only', async () => {
    const token = await createR2Capability(
      { kind: 'read', key: 'ws/acme/report.parquet', queryId: 'query-1' },
      'secret',
    );
    const response = await handleInternalR2Request(
      new Request(capabilityUrl(token), { method: 'PUT', body: 'data' }),
      { INTERNAL_R2_SIGNING_SECRET: 'secret' } as unknown as Cloudflare.Env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
