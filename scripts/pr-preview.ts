import { appendFile } from 'node:fs/promises';
import { experimental_readRawConfig } from 'wrangler';
import { z } from 'zod';

const action = z.enum(['prepare', 'cleanup']).parse(process.argv[2]);
const pr = z
  .string()
  .regex(/^[1-9]\d*$/)
  .parse(process.argv[3]);
const previewName = `pr-${pr}`;
const workerName = 'rundown-preview';
const resourceName = `${workerName}-${previewName}`;
const configPath = '.wrangler-pr.json';
const { rawConfig } = experimental_readRawConfig({ config: 'wrangler.jsonc' });
const template = rawConfig.env?.preview;
if (template?.name !== workerName || !rawConfig.account_id) {
  throw new Error('Expected the rundown-preview environment and a Cloudflare account ID.');
}
const token = z.string().min(1).parse(process.env.CLOUDFLARE_API_TOKEN);
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${rawConfig.account_id}`;
const databaseSchema = z.object({ uuid: z.string(), name: z.string() });
const namespaceSchema = z.object({ id: z.string(), title: z.string() });

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Deletion is repeatable, including partially provisioned or never deployed PRs.
  if (response.status === 404 && method === 'DELETE') return null;
  const envelope = z
    .object({ success: z.boolean(), result: z.unknown() })
    .parse(await response.json());
  if (!response.ok || !envelope.success) {
    throw new Error(`Cloudflare ${method} ${path} failed with HTTP ${response.status}`);
  }
  return envelope.result;
}

async function list<T>(path: string, schema: z.ZodType<T>) {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const batch = z.array(schema).parse(await api(`${path}?page=${page}&per_page=100`));
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${command[0]}`);
}

const databases = await list('/d1/database', databaseSchema);
const namespaces = await list('/storage/kv/namespaces', namespaceSchema);
const database = databases.find((item) => item.name === resourceName);
const namespace = namespaces.find((item) => item.title === resourceName);

if (action === 'prepare') {
  const db =
    database ?? databaseSchema.parse(await api('/d1/database', 'POST', { name: resourceName }));
  const kv =
    namespace ??
    namespaceSchema.parse(await api('/storage/kv/namespaces', 'POST', { title: resourceName }));
  const buckets = z
    .object({ buckets: z.array(z.object({ name: z.string() })) })
    .parse(await api('/r2/buckets'));
  if (!buckets.buckets.some((bucket) => bucket.name === resourceName)) {
    await api('/r2/buckets', 'POST', { name: resourceName });
  }
  const bindings = {
    vars: {
      ...template.vars,
      QUERY_CACHE_NAME: resourceName,
      R2_BUCKET_NAME: resourceName,
      DATA_SOURCE_BASE_URL: `r2://${resourceName}`,
      QUERY_DATA_SOURCE_BASE_URL: `r2://${resourceName}`,
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: resourceName,
        database_id: db.uuid,
        migrations_dir: 'drizzle',
      },
    ],
    kv_namespaces: [{ binding: 'QUERY_CACHE', id: kv.id }],
    r2_buckets: [{ binding: 'DATA', bucket_name: resourceName }],
    analytics_engine_datasets: template.analytics_engine_datasets,
    containers: template.containers,
    durable_objects: template.durable_objects,
  };
  // Keep paths relative to the repository. Vite builds from this same config, and migrations
  // target the same D1 database that the Preview receives.
  await Bun.write(
    configPath,
    JSON.stringify(
      {
        ...rawConfig,
        ...template,
        ...bindings,
        name: workerName,
        env: undefined,
        routes: [],
        previews: bindings,
      },
      null,
      2,
    ),
  );
  console.log(`Prepared ${resourceName}`);
} else {
  // Attempt every cleanup even if one service fails. Rerunning discovers resources by their
  // exact PR name, without relying on artifacts from a successful deployment.
  const failures: unknown[] = [];
  async function cleanup(operation: () => Promise<unknown>) {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
      console.error(error);
    }
  }
  await cleanup(() => api(`/workers/workers/${workerName}/previews/${previewName}`, 'DELETE'));
  await cleanup(async () => {
    const child = Bun.spawn(['bunx', 'wrangler', 'containers', 'list', '--json'], {
      stdout: 'pipe',
      stderr: 'inherit',
    });
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error('Could not list container apps');
    const apps = z.array(z.object({ id: z.string(), name: z.string() })).parse(JSON.parse(output));
    for (const app of apps.filter((item) =>
      item.name.startsWith(`${workerName}_${previewName}_`),
    )) {
      await cleanup(() => run(['bunx', 'wrangler', 'containers', 'delete', app.id]));
    }
  });
  if (database) await cleanup(() => api(`/d1/database/${database.uuid}`, 'DELETE'));
  if (namespace) await cleanup(() => api(`/storage/kv/namespaces/${namespace.id}`, 'DELETE'));
  await cleanup(async () => {
    const buckets = z
      .object({ buckets: z.array(z.object({ name: z.string() })) })
      .parse(await api('/r2/buckets'));
    if (!buckets.buckets.some((bucket) => bucket.name === resourceName)) return;
    const jobSchema = z.object({ id: z.string(), status: z.string() });
    let job = jobSchema.parse(await api(`/r2/buckets/${resourceName}/objects?prefix=`, 'DELETE'));
    const deadline = Date.now() + 10 * 60_000;
    while (job.status !== 'COMPLETED') {
      if (['FAILED', 'CANCELLED'].includes(job.status) || Date.now() > deadline) {
        throw new Error(`R2 empty-bucket job ${job.id} did not complete: ${job.status}`);
      }
      await Bun.sleep(5000);
      job = jobSchema.parse(await api(`/r2/buckets/${resourceName}/jobs/${job.id}`));
    }
    await api(`/r2/buckets/${resourceName}`, 'DELETE');
  });
  if (failures.length)
    throw new AggregateError(failures, `Cleanup failed for ${resourceName}; rerun the workflow.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Removed Preview and PR resources for ${previewName}.\n`,
    );
  }
}
