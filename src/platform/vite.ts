import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import type { PluginOption } from 'vite';
import { imagetools } from 'vite-imagetools';

// The compiled plugin lives at dist/platform/vite.js, the same depth as this source file.
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceDirectory = resolve(packageRoot, 'src');
const escapedSource = sourceDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface YresonanceOptions {
  /** Path to the deployment config, relative to the project directory. */
  config?: string;
}

// Builds the yresonance app with the project's deployment config. The app sources stay in this
// package, which may be installed under node_modules. The project directory supplies the config
// file and env files and receives the build output.
export function yresonance(options: YresonanceOptions = {}): PluginOption[] {
  const project = process.cwd();
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
            {
              find: /^yresonance:config$/,
              replacement: resolve(project, options.config ?? 'yresonance.config.ts'),
            },
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
