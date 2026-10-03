import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));
import { handleResetRequest } from './reset.server';

describe('environment reset', () => {
  it('requires authorization before inspecting resources', async () => {
    const environment = resetEnvironment('preview');
    const response = await handleResetRequest(resetRequest('preview'), environment.bindings);

    expect(response.status).toBe(401);
    expect(environment.listR2).not.toHaveBeenCalled();
    expect(environment.listKv).not.toHaveBeenCalled();
  });

  it('refuses a request for a different environment', async () => {
    const environment = resetEnvironment('preview');
    const response = await handleResetRequest(
      resetRequest('development', 'reset-secret'),
      environment.bindings,
    );

    expect(response.status).toBe(409);
    expect(environment.listR2).not.toHaveBeenCalled();
  });

  it('returns an exact production plan without deleting anything', async () => {
    const environment = resetEnvironment('production');
    const response = await handleResetRequest(
      resetRequest('production', 'reset-secret'),
      environment.bindings,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      executed: false,
      plan: {
        environment: 'production',
        d1Tables: expect.arrayContaining(['query_read_budgets']),
        r2ObjectKeys: ['workspace/data.parquet'],
        kvNamespace: 'yresonance-query-cache',
        kvKeys: ['query-cache-key'],
      },
    });
    expect(environment.batch).not.toHaveBeenCalled();
    expect(environment.deleteR2).not.toHaveBeenCalled();
    expect(environment.deleteKv).not.toHaveBeenCalled();
  });
});

function resetRequest(environment: string, token?: string) {
  return new Request('https://yresonance.test/api/admin/reset', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify({ environment }),
  });
}

function resetEnvironment(appEnvironment: 'preview' | 'production') {
  const listR2 = vi.fn<() => Promise<{ objects: Array<{ key: string }>; truncated: boolean }>>();
  listR2.mockResolvedValue({
    objects: [{ key: 'workspace/data.parquet' }],
    truncated: false,
  });
  const listKv = vi.fn<() => Promise<{ keys: Array<{ name: string }>; list_complete: boolean }>>();
  listKv.mockResolvedValue({
    keys: [{ name: 'query-cache-key' }],
    list_complete: true,
  });
  const batch = vi.fn<() => void>();
  const deleteR2 = vi.fn<() => void>();
  const deleteKv = vi.fn<() => void>();
  const bindings = {
    APP_ENV: appEnvironment,
    RESET_ADMIN_TOKEN: 'reset-secret',
    QUERY_CACHE_NAME: 'yresonance-query-cache',
    DB: { prepare: vi.fn<() => void>(), batch },
    DATA: { list: listR2, delete: deleteR2 },
    QUERY_CACHE: { list: listKv, delete: deleteKv },
  } as unknown as Cloudflare.Env;
  return { bindings, listR2, listKv, batch, deleteR2, deleteKv };
}
