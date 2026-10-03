import { Container } from '@cloudflare/containers';
import { handleInternalR2Request, INTERNAL_R2_HOST } from '#/data/internal-r2';

export class QueryEngineContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = 'localhost/ready';
  sleepAfter = '10m';
  enableInternet = false;

  override async startAndWaitForPorts(...args: Parameters<Container['startAndWaitForPorts']>) {
    const [portsOrOptions, cancellationOptions, startOptions] = args;
    const options =
      typeof portsOrOptions === 'object' && !Array.isArray(portsOrOptions)
        ? portsOrOptions
        : { ports: portsOrOptions, cancellationOptions, startOptions };
    const startedAt = performance.now();
    try {
      await super.startAndWaitForPorts({
        ...options,
        // The SDK defaults to 300 ms between checks, longer than our process startup.
        cancellationOptions: { waitInterval: 50, ...options?.cancellationOptions },
      });
      console.info('rundown.query_engine_start', {
        outcome: 'ready',
        startupDurationMs: performance.now() - startedAt,
      });
    } catch (error) {
      console.warn('rundown.query_engine_start', {
        outcome: 'error',
        startupDurationMs: performance.now() - startedAt,
      });
      throw error;
    }
  }
}

QueryEngineContainer.outboundByHost = {
  [INTERNAL_R2_HOST]: handleInternalR2Request,
};
