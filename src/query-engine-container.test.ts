import { describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  handler: vi.fn<() => void>(),
  registrations: [] as Array<Record<string, unknown>>,
}));

vi.mock('@cloudflare/containers', () => ({
  Container: class {
    static set outboundByHost(handlers: Record<string, unknown>) {
      testState.registrations.push(handlers);
    }
  },
}));

vi.mock('#/data/internal-r2', () => ({
  INTERNAL_R2_HOST: 'r2.yresonance.internal',
  handleInternalR2Request: testState.handler,
}));

import { QueryEngineContainer } from './query-engine-container';

describe('QueryEngineContainer', () => {
  it('registers the private R2 handler through the Containers SDK accessor', () => {
    expect(testState.registrations).toEqual([
      {
        'r2.yresonance.internal': testState.handler,
      },
    ]);
    expect(Object.hasOwn(QueryEngineContainer, 'outboundByHost')).toBe(false);
  });
});
