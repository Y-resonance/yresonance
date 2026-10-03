import { describe, expect, it } from 'vitest';

import { createHealthResponse } from './health';

describe('health response', () => {
  it('reports a healthy service without allowing caches to hide a deployment', async () => {
    const response = createHealthResponse();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      service: 'yresonance',
      status: 'ok',
    });
  });
});
