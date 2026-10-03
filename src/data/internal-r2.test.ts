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

  it('streams browser uploads only for a pending opaque key', async () => {
    const key = 'ws/acme/uploads/2026-09-01/550e8400-e29b-41d4-a716-446655440000.csv';
    const first = vi.fn<() => Promise<{ pending: number }>>().mockResolvedValue({ pending: 1 });
    const bind = vi
      .fn<(key: string, workspaceId: string, userId: string) => { first: typeof first }>()
      .mockReturnValue({ first });
    const prepare = vi.fn<(query: string) => { bind: typeof bind }>().mockReturnValue({ bind });
    const put = vi
      .fn<(key: string, body: ReadableStream, options: unknown) => Promise<{ httpEtag: string }>>()
      .mockResolvedValue({ httpEtag: '"etag"' });
    const environment = { DB: { prepare }, DATA: { put } } as unknown as Cloudflare.Env;
    const path = browserUploadPath(key);
    expect(path).not.toContain(key);

    const response = await handleBrowserUploadRequest(
      new Request(`https://yresonance.test${path}`, {
        method: 'PUT',
        headers: { 'content-length': '4' },
        body: 'data',
      }),
      path.slice('/api/datasource-upload/'.length),
      environment,
      { userId: 'user-1', workspaceId: 'workspace-1', workspacePrefix: 'ws/acme/' },
    );

    expect(response.status).toBe(201);
    expect(bind).toHaveBeenCalledWith(key, 'workspace-1', 'user-1');
    expect(put).toHaveBeenCalledWith(
      key,
      expect.any(ReadableStream),
      expect.objectContaining({ onlyIf: { etagDoesNotMatch: '*' } }),
    );
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

  it('rejects range reads after the query byte budget is exhausted', async () => {
    const token = await createR2Capability(
      { kind: 'read', key: 'ws/acme/report.parquet', queryId: 'query-1' },
      'secret',
    );
    const first = vi
      .fn<() => Promise<{ scanned_bytes: number } | undefined>>()
      .mockResolvedValueOnce({ scanned_bytes: 4 })
      .mockResolvedValueOnce(undefined);
    const bind = vi.fn<() => { first: typeof first }>().mockReturnValue({ first });
    const prepare = vi.fn<() => { bind: typeof bind }>().mockReturnValue({ bind });
    const get = vi.fn<(key: string) => object>().mockImplementation(() => ({
      body: new Response('data').body,
      size: 4,
      range: { offset: 0, length: 4 },
      httpEtag: '"etag"',
      uploaded: new Date('2026-09-01T00:00:00.000Z'),
      httpMetadata: { contentType: 'application/vnd.apache.parquet' },
      writeHttpMetadata: vi.fn<(headers: Headers) => void>(),
    }));
    const environment = {
      INTERNAL_R2_SIGNING_SECRET: 'secret',
      DB: { prepare },
      DATA: { get },
    } as unknown as Cloudflare.Env;
    const read = () =>
      handleInternalR2Request(
        new Request(capabilityUrl(token), { headers: { range: 'bytes=0-3' } }),
        environment,
      );

    await expect(read().then((response) => response.status)).resolves.toBe(206);
    await expect(read().then((response) => response.status)).resolves.toBe(413);
  });

  it('accepts an ingestion destination only once', async () => {
    const token = await createR2Capability(
      {
        kind: 'ingestion',
        tokenId: 'ingestion-1',
        sourceKey: 'ws/acme/upload.csv',
        destinationKey: 'ws/acme/upload.parquet',
      },
      'secret',
    );
    const first = vi
      .fn<() => Promise<{ id: string } | undefined>>()
      .mockResolvedValueOnce({ id: 'ingestion-1' })
      .mockResolvedValueOnce(undefined);
    const bind = vi
      .fn<(usedAt: string, tokenId: string, now: string) => { first: typeof first }>()
      .mockReturnValue({ first });
    const prepare = vi.fn<(query: string) => { bind: typeof bind }>().mockReturnValue({ bind });
    const put = vi
      .fn<(key: string, body: ReadableStream, options: unknown) => Promise<{ httpEtag: string }>>()
      .mockResolvedValue({ httpEtag: '"etag"' });
    const environment = {
      INTERNAL_R2_SIGNING_SECRET: 'secret',
      DB: { prepare },
      DATA: { put },
    } as unknown as Cloudflare.Env;
    const upload = () =>
      handleInternalR2Request(
        new Request(capabilityUrl(token), {
          method: 'PUT',
          headers: { 'content-length': '4' },
          body: 'data',
        }),
        environment,
      );

    await expect(upload().then((response) => response.status)).resolves.toBe(201);
    await expect(upload().then((response) => response.status)).resolves.toBe(409);
    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(
      'ws/acme/upload.parquet',
      expect.any(ReadableStream),
      expect.objectContaining({ onlyIf: { etagDoesNotMatch: '*' } }),
    );
  });

  it('releases an ingestion token when the object write fails', async () => {
    const token = await createR2Capability(
      {
        kind: 'ingestion',
        tokenId: 'ingestion-1',
        sourceKey: 'ws/acme/upload.csv',
        destinationKey: 'ws/acme/upload.parquet',
      },
      'secret',
    );
    const claimFirst = vi
      .fn<() => Promise<{ id: string } | undefined>>()
      .mockResolvedValue({ id: 'ingestion-1' });
    const claimBind = vi.fn<() => { first: typeof claimFirst }>().mockReturnValue({
      first: claimFirst,
    });
    const releaseRun = vi.fn<() => Promise<void>>().mockResolvedValue();
    const releaseBind = vi.fn<() => { run: typeof releaseRun }>().mockReturnValue({
      run: releaseRun,
    });
    const prepare = vi
      .fn<(query: string) => object>()
      .mockReturnValueOnce({ bind: claimBind })
      .mockReturnValueOnce({ bind: releaseBind });
    const environment = {
      INTERNAL_R2_SIGNING_SECRET: 'secret',
      DB: { prepare },
      DATA: { put: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('R2 unavailable')) },
    } as unknown as Cloudflare.Env;

    await expect(
      handleInternalR2Request(
        new Request(capabilityUrl(token), {
          method: 'PUT',
          headers: { 'content-length': '4' },
          body: 'data',
        }),
        environment,
      ),
    ).rejects.toThrow('R2 unavailable');
    expect(releaseRun).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenLastCalledWith(
      'UPDATE ingestion_tokens SET used_at = NULL WHERE id = ? AND used_at = ?',
    );
  });
});
