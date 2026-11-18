// Proves the npm package works for a self-hoster: packs it, installs the tarball into a fresh
// project (tests/package), type-checks and builds that project, migrates a database with the
// packaged command and requests data from the running app.
//
// Needs Postgres. Uses TEST_DATABASE_URL, by default the local test database.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';
import { z } from 'zod';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = await Bun.file(`${root}package.json`).json();
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://yresonance:yresonance@localhost:5432/yresonance_test';
// The app creates a workspace for its fixed identity, so this must never be a real database.
if (!new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('TEST_DATABASE_URL must name a dedicated _test database.');
const port = 3187;

const project = await mkdtemp(join(tmpdir(), 'yresonance-package-'));
let app: Bun.Subprocess | undefined;
try {
  await $`bun pm pack --filename ${join(project, 'core.tgz')}`.cwd(root);
  await cp(`${root}tests/package`, project, { recursive: true });
  await Bun.write(
    join(project, 'package.json'),
    JSON.stringify({
      name: 'yresonance-package-check',
      private: true,
      type: 'module',
      dependencies: {
        '@yresonance-dev/core': 'file:./core.tgz',
        // The config file imports createMiddleware for its auth stand-in.
        '@tanstack/react-start': manifest.dependencies['@tanstack/react-start'],
        vite: manifest.devDependencies.vite,
      },
      devDependencies: {
        '@types/node': manifest.devDependencies['@types/node'],
        typescript: manifest.devDependencies.typescript,
      },
    }),
  );

  const run = $.cwd(project).env({ ...process.env, DATABASE_URL: databaseUrl, PORT: `${port}` });
  await run`bun install`;
  await run`bunx tsc -p .`;
  // Node, not Bun: the published plugin and command must run without a TypeScript loader.
  await run`node node_modules/vite/bin/vite.js build`;
  await run`node node_modules/.bin/yresonance migrate`;

  app = Bun.spawn(['bun', 'server.ts'], {
    cwd: project,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: `${port}` },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const response = await retry(() =>
    fetch(`http://localhost:${port}/api/yresonance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'listDashboards' }),
    }),
  );
  const body = await response.text();
  if (!response.ok || !z.object({ ok: z.literal(true) }).safeParse(JSON.parse(body)).success)
    throw new Error(`The packaged app answered ${response.status}: ${body}`);
  console.log('The packaged app builds, migrates and serves API requests.');
} finally {
  app?.kill();
  await rm(project, { recursive: true, force: true });
}

async function retry<T>(operation: () => Promise<T>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 50) throw error;
      await Bun.sleep(100);
    }
  }
}
