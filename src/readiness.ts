export type ReadinessDependency = 'd1' | 'kv' | 'r2';

type DependencyStatus = 'ok' | 'failed';

export interface ReadinessChecks {
  d1: () => Promise<void>;
  kv: () => Promise<void>;
  r2: () => Promise<void>;
}

export interface ReadinessResult {
  dependencies: Record<ReadinessDependency, DependencyStatus>;
  ready: boolean;
}

export async function checkReadiness(
  checks: ReadinessChecks,
  onFailure?: (dependency: ReadinessDependency, error: unknown) => void,
): Promise<ReadinessResult> {
  const [d1, kv, r2] = await Promise.all([
    checkDependency('d1', checks.d1, onFailure),
    checkDependency('kv', checks.kv, onFailure),
    checkDependency('r2', checks.r2, onFailure),
  ]);
  const dependencies = {
    d1: d1[1],
    kv: kv[1],
    r2: r2[1],
  };

  return {
    dependencies,
    ready: Object.values(dependencies).every((status) => status === 'ok'),
  };
}

export function createReadinessResponse(result: ReadinessResult) {
  return Response.json(
    {
      service: 'yresonance',
      status: result.ready ? 'ready' : 'not_ready',
      dependencies: result.dependencies,
    },
    {
      status: result.ready ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

async function checkDependency(
  dependency: ReadinessDependency,
  check: () => Promise<void>,
  onFailure?: (dependency: ReadinessDependency, error: unknown) => void,
): Promise<readonly [ReadinessDependency, DependencyStatus]> {
  try {
    await check();
    return [dependency, 'ok'];
  } catch (error) {
    onFailure?.(dependency, error);
    return [dependency, 'failed'];
  }
}
