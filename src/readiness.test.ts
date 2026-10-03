import { describe, expect, it, vi } from 'vitest';

import {
  checkReadiness,
  createReadinessResponse,
  type ReadinessChecks,
  type ReadinessDependency,
} from './readiness';

function passingChecks(): ReadinessChecks {
  return {
    d1: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    kv: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    r2: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('readiness', () => {
  it('reports ready after every dependency responds', async () => {
    const checks = passingChecks();
    const result = await checkReadiness(checks);
    const response = createReadinessResponse(result);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      service: 'yresonance',
      status: 'ready',
      dependencies: {
        d1: 'ok',
        kv: 'ok',
        r2: 'ok',
      },
    });
  });

  it('reports the failed dependency without exposing its error', async () => {
    const checks = passingChecks();
    const failure = new Error('secret connection detail');
    checks.r2 = vi.fn<() => Promise<void>>().mockRejectedValue(failure);
    const onFailure = vi.fn<(dependency: ReadinessDependency, error: unknown) => void>();

    const result = await checkReadiness(checks, onFailure);
    const response = createReadinessResponse(result);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain(failure.message);
    expect(JSON.parse(body)).toEqual({
      service: 'yresonance',
      status: 'not_ready',
      dependencies: {
        d1: 'ok',
        kv: 'ok',
        r2: 'failed',
      },
    });
    expect(onFailure).toHaveBeenCalledWith('r2', failure);
  });
});
