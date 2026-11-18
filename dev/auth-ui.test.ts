import { expect, test } from 'vitest';
import { selectedAuthAdapter } from './auth-ui';

test('follows the active auth entry, not a commented-out one', () => {
  const config = `export default defineConfig({
    // auth: clerk(),
    /* auth: legacy(), */
    auth: oidc(),
  });`;

  expect(selectedAuthAdapter(config)).toBe('oidc');
});

test('stops the build when the config selects no single auth adapter', () => {
  expect(() => selectedAuthAdapter('export default defineConfig({});')).toThrow(/exactly one/);
  expect(() => selectedAuthAdapter('auth: clerk(), auth: oidc()')).toThrow(/exactly one/);
});
