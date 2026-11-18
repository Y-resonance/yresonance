import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import type { PluginOption } from 'vite';
import { imagetools } from 'vite-imagetools';
import { authUiAlias } from './auth-ui-alias.ts';

// The compiled plugin lives at dist/platform/vite.js, the same depth as this source file.
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceDirectory = resolve(packageRoot, 'src');
const escapedSource = sourceDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface YresonanceOptions {
  /** Path to the deployment config, relative to the project directory. */
  config?: string;
  /**
   * Path to the UI half of an auth adapter of your own, relative to the project directory. The
   * adapters this package ships are found by the name in the config's `auth` entry.
   */
  authUi?: string;
}

// Builds the yresonance app with the project's deployment config. The app sources stay in this
// package, which may be installed under node_modules. The project directory supplies the config
// file and env files and receives the build output.
export function yresonance(options: YresonanceOptions = {}): PluginOption[] {
  const project = process.cwd();
  const config = resolve(project, options.config ?? 'yresonance.config.ts');
  return [
    {
      name: 'yresonance',
      // The other plugins read the root in their own config hooks, so this one has to run first.
      enforce: 'pre',
      config: () => ({
        root: packageRoot,
        envDir: project,
        cacheDir: resolve(project, 'node_modules/.vite'),
        // Vite only empties output directories inside the root by default.
        build: { outDir: resolve(project, 'dist'), emptyOutDir: true },
        resolve: {
          alias: [
            { find: /^yresonance:config$/, replacement: config },
            authUiAlias({
              config,
              adapters: resolve(sourceDirectory, 'platform/adapters'),
              override: options.authUi && resolve(project, options.authUi),
            }),
            // tsconfig paths do not apply to files under node_modules.
            { find: /^#\//, replacement: `${sourceDirectory}/` },
          ],
        },
      }),
    },
    imagetools(),
    tailwindcss(),
    tanstackStart(),
    viteReact({
      // Both filters skip node_modules by default, which would leave an installed app uncompiled.
      compiler: { sources: [sourceDirectory] },
      exclude: new RegExp(`^(?!${escapedSource}/).*/node_modules/`),
    }),
  ];
}
