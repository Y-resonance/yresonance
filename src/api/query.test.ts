import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { apiQueryOptions } from './query';

afterEach(() => vi.unstubAllGlobals());

it('shares identical reads within a workspace but never serves another session its cached data', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ok: true, data: { name: 'First workspace' } }))
    .mockResolvedValueOnce(Response.json({ ok: true, data: { name: 'Second workspace' } }));
  vi.stubGlobal('fetch', fetchMock);
  const first = apiQueryOptions<{ name: string }>('session-a:workspace-a', { action: 'bootstrap' });
  const second = apiQueryOptions<{ name: string }>('session-b:workspace-b', {
    action: 'bootstrap',
  });
  try {
    expect(await Promise.all([client.fetchQuery(first), client.fetchQuery(first)])).toEqual([
      { name: 'First workspace' },
      { name: 'First workspace' },
    ]);
    expect(await client.fetchQuery(second)).toEqual({ name: 'Second workspace' });
    expect(await client.fetchQuery(first)).toEqual({ name: 'First workspace' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    client.clear();
  }
});

it('aborts the HTTP request when Query cancels a read', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let transportSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      transportSignal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {
          once: true,
        });
      });
    }),
  );
  const options = apiQueryOptions('session:workspace', { action: 'bootstrap' });
  try {
    const request = client.fetchQuery(options).catch(() => undefined);
    await client.cancelQueries({ queryKey: options.queryKey });
    await request;
    expect(transportSignal?.aborted).toBe(true);
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
  } finally {
    client.clear();
  }
});
