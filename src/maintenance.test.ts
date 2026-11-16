import { expect, test } from 'vitest';
import { maintenanceResponse } from './maintenance';

test.each([undefined, '', '0', 'false'])(
  'disabled maintenance leaves application routing available (%s)',
  (mode) => {
    expect(
      maintenanceResponse(
        new Request('https://yresonance.test/api/yresonance', { method: 'POST' }),
        mode,
      ),
    ).toBeUndefined();
  },
);

test.each(['/', '/api/yresonance', '/api/admin/reset', '/health', '/ready/'])(
  'maintenance blocks traffic to %s without caching the outage',
  async (path) => {
    const response = maintenanceResponse(
      new Request(`https://yresonance.test${path}`, { method: 'POST' }),
      '1',
    );
    expect(response?.status).toBe(503);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(response?.headers.get('retry-after')).toBe('60');
    expect(await response?.text()).toContain('undergoing maintenance');
  },
);

test('maintenance preserves readiness and supports HEAD requests', () => {
  expect(
    maintenanceResponse(new Request('https://yresonance.test/ready?probe=1'), '1'),
  ).toBeUndefined();
  const response = maintenanceResponse(
    new Request('https://yresonance.test/', { method: 'HEAD' }),
    '1',
  );
  expect(response?.status).toBe(503);
  expect(response?.body).toBeNull();
});
