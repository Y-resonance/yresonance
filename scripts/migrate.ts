import { z } from 'zod';
const variable = z.string().min(1).parse(process.argv[2]);
const url = process.env[variable];
if (!url) throw new Error(`Set ${variable} to the direct Postgres migration connection string.`);
const child = Bun.spawn(['bunx', 'drizzle-kit', 'migrate'], {
  env: { ...process.env, DATABASE_URL: url },
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await child.exited);
