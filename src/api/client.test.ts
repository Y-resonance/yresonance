import { afterEach, describe, expect, it, vi } from 'vitest';
import { callApi } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('API client boundary', () => {
  it('surfaces typed API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({ ok: false, error: { code: 'invalid_query', message: 'Bad formula.' } }),
        ),
      ),
    );
    await expect(callApi({ action: 'bootstrap' })).rejects.toThrow('Bad formula.');
  });

  it('rejects malformed responses at the network boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ data: 'missing envelope' }))),
    );
    await expect(callApi({ action: 'bootstrap' })).rejects.toThrow('Invalid discriminator');
  });

  it('passes cancellation through to fetch', async () => {
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(() => Promise.resolve(Response.json({ ok: true, data: { ready: true } })));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await callApi({ action: 'bootstrap' }, { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/yresonance',
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
