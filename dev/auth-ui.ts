import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** Name of the adapter in the config's `auth` entry, ignoring commented-out entries. */
export function selectedAuthAdapter(configSource: string) {
  const code = configSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const adapters = [...code.matchAll(/\bauth:\s*(\w+)\(/g)].map((match) => match[1]);
  if (adapters.length !== 1)
    throw new Error(
      `cloud/yresonance.config.ts must select exactly one auth adapter, found ${adapters.length}.`,
    );
  return adapters[0];
}

/**
 * Alias for `virtual:auth-ui`: the UI half of the auth adapter that cloud/yresonance.config.ts
 * selects. `auth: clerk()` resolves to src/platform/adapters/clerk-ui.tsx. The config is read as
 * text because it imports server-only modules and cannot be loaded by the build or the browser.
 */
export function authUiAlias(override?: string) {
  const adapter = selectedAuthAdapter(readFileSync(fromRoot('cloud/yresonance.config.ts'), 'utf8'));
  const replacement = fromRoot(override ?? `src/platform/adapters/${adapter}-ui.tsx`);
  if (!existsSync(replacement))
    throw new Error(`Auth adapter "${adapter}" has no UI half at ${replacement}.`);
  return { find: 'virtual:auth-ui', replacement };
}
