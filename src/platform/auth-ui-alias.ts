import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Name of the adapter in the config's `auth` entry, ignoring commented-out entries. */
export function selectedAuthAdapter(configSource: string) {
  const code = configSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const adapters = [...code.matchAll(/\bauth:\s*(\w+)\(/g)].map((match) => match[1]);
  if (adapters.length !== 1)
    throw new Error(
      `The deployment config must select exactly one auth adapter, found ${adapters.length}. An auth adapter of your own needs the \`authUi\` option of the yresonance Vite plugin.`,
    );
  return adapters[0];
}

/**
 * Alias for `virtual:auth-ui`: the UI half of the auth adapter the deployment config selects.
 * `auth: clerk()` resolves to `<adapters>/clerk-ui.tsx`. The config is read as text because it
 * imports server-only modules and cannot be loaded by the build or the browser. `override` names
 * a UI half directly, for adapters that do not live in `adapters`.
 */
export function authUiAlias(options: { config: string; adapters: string; override?: string }) {
  const replacement =
    options.override ??
    resolve(
      options.adapters,
      `${selectedAuthAdapter(readFileSync(options.config, 'utf8'))}-ui.tsx`,
    );
  if (!existsSync(replacement)) throw new Error(`There is no auth UI half at ${replacement}.`);
  return { find: 'virtual:auth-ui', replacement };
}
