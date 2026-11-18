// Prepares the files the npm package ships in addition to the app sources.
//
// The app itself is published as source and built by the installing project. What that project
// imports directly must work from node_modules: type declarations without the repository's `#/`
// paths, and the Vite plugin as plain JavaScript, because Node does not run TypeScript there.
import { rm } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, Glob } from 'bun';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = `${root}dist/types`;
const typedSources = `${types}/src`;
$.cwd(root);

await rm(`${root}dist/platform`, { recursive: true, force: true });
await rm(types, { recursive: true, force: true });

// The preview example and the route tree are build inputs the installing project cannot create.
await $`bun run prepare:preview-example`;
await $`bun run generate-routes`;

await $`bunx tsc -p tsconfig.package.json`;
for await (const file of new Glob('**/*.d.ts').scan({ cwd: typedSources, absolute: true })) {
  const source = await Bun.file(file).text();
  const toSource = relative(dirname(file), typedSources) || '.';
  const rewritten = source.replace(/(['"])#\//g, `$1${toSource}/`);
  if (rewritten !== source) await Bun.write(file, rewritten);
}

const plugin = await Bun.build({
  entrypoints: [`${root}src/platform/vite.ts`],
  outdir: `${root}dist/platform`,
  target: 'node',
  packages: 'external',
});
if (!plugin.success) throw new AggregateError(plugin.logs, 'Could not compile the Vite plugin.');
