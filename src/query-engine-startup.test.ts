import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
  WorkerEntrypoint: class {},
}));

vi.mock('#/data/internal-r2', () => ({
  INTERNAL_R2_HOST: 'r2.rundown.internal',
  handleInternalR2Request: vi.fn<() => void>(),
}));

import { QueryEngineContainer } from './query-engine-container';

/** The real SDK waits for a simulated port; VM allocation and DO storage are unavailable in Vitest. */
function startingContainer() {
  const readyAt = performance.now() + 110;
  const container: QueryEngineContainer = Object.assign(
    Object.create(QueryEngineContainer.prototype) as QueryEngineContainer,
    {
      requiredPorts: [8080],
      defaultPort: 8080,
      pingEndpoint: 'localhost/ready',
      container: {
        running: true,
        getTcpPort: () => ({
          fetch: async () => {
            if (performance.now() < readyAt) throw new Error('Port is not listening yet.');
            return new Response('ready');
          },
        }),
      },
      syncPendingStoppedEvents: async () => {},
      startContainerIfNotRunning: async () => 0,
      setupMonitorCallbacks: () => {},
      state: { setHealthy: async () => {} },
      ctx: { blockConcurrencyWhile: (callback: () => Promise<void>) => callback() },
      onStart: async () => {},
      onError: async () => {},
    },
  );
  return container;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('query engine startup', () => {
  it('detects readiness without waiting for the SDK default 300 ms polling interval', async () => {
    const container = startingContainer();
    let ready = false;
    const startup = container.startAndWaitForPorts().then(() => {
      ready = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(ready).toBe(true);
    await startup;
  });

  it.each(['positional', 'options'] as const)(
    'preserves cancellation through the %s startup API',
    async (style) => {
      const container = startingContainer();
      const controller = new AbortController();
      const startup =
        style === 'positional'
          ? container.startAndWaitForPorts(8080, { abort: controller.signal })
          : container.startAndWaitForPorts({
              ports: [8080],
              cancellationOptions: { abort: controller.signal },
            });
      const rejected = startup.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(25);
      controller.abort();
      await vi.advanceTimersByTimeAsync(25);
      expect(await rejected).toMatchObject({ message: 'Container request aborted.' });
    },
  );
});
