import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/**
 * Alias for `virtual:auth-ui`: the UI half of the auth adapter that cloud/yresonance.config.ts
 * selects. `auth: clerk()` resolves to src/platform/adapters/clerk-ui.tsx. The config is read as
 * text because it imports server-only modules and cannot be loaded by the build or the browser.
 */
export function authUiAlias(override?: string) {
  const adapter = /\bauth:\s*(\w+)\(/.exec(
    readFileSync(fromRoot('cloud/yresonance.config.ts'), 'utf8'),
  )?.[1];
  if (!adapter) throw new Error('cloud/yresonance.config.ts selects no auth adapter.');
  const replacement = fromRoot(override ?? `src/platform/adapters/${adapter}-ui.tsx`);
  if (!existsSync(replacement))
    throw new Error(`Auth adapter "${adapter}" has no UI half at ${replacement}.`);
  return { find: 'virtual:auth-ui', replacement };
}
