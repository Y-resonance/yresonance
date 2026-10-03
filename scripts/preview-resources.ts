import { appendFile } from 'node:fs/promises';
import { previewResourceName } from './preview-config';
import { experimental_readRawConfig } from 'wrangler';
import { z } from 'zod';

const action = z.enum(['prepare', 'cleanup', 'cleanup-legacy']).parse(process.argv[2]);
const branch = z
  .string()
  .min(1)
  .parse(process.argv[3] ?? process.env.WORKERS_CI_BRANCH);
const legacy = action === 'cleanup-legacy';
if (legacy)
  z.string()
    .regex(/^[1-9]\d*$/)
    .parse(branch);
const previewName = legacy ? `pr-${branch}` : branch;
const configPath = '.wrangler-branch.json';
const { rawConfig } = experimental_readRawConfig({ config: 'wrangler.jsonc' });
const workerName = z.string().min(1).parse(rawConfig.name);
const template = rawConfig.previews;
if (!template || !rawConfig.account_id)
  throw new Error('Expected a previews block and a Cloudflare account ID.');
if (!legacy) previewResourceName(workerName, branch);
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
  if (response.status === 404 && (method === 'DELETE' || path.startsWith('/workers/workers/')))
    return null;
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

// Native Preview builds have their own history, separate from production builds.
// Wait for every build of this branch before deleting resources it can still use.
if (action === 'cleanup') {
  const tag = z.string().min(1).parse(process.env.CLOUDFLARE_WORKER_TAG);
  const previews = await list(
    `/builds/workers/${tag}/previews`,
    z.object({ preview_id: z.string(), branch: z.string() }),
  );
  const preview = previews.find((item) => item.branch === branch);
  if (preview) {
    while (true) {
      const builds = await list(
        `/builds/workers/${tag}/previews/${preview.preview_id}/builds`,
        z.object({ status: z.string() }),
      );
      if (builds.every((build) => build.status === 'stopped')) break;
      console.log(`Waiting for Cloudflare builds on ${branch} before cleanup.`);
      await Bun.sleep(10_000);
    }
  }
}

// Legacy PR resources remain eligible for cleanup during the transition to branch previews.
const workerNames = legacy ? ['yresonance-preview', 'rundown-preview'] : [workerName];
const cleanupFailures: unknown[] = [];
for (const name of workerNames) {
  try {
    await manageResources(name);
  } catch (error) {
    if (action === 'prepare') throw error;
    cleanupFailures.push(error);
  }
}
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'PR cleanup failed.');

async function manageResources(workerName: string) {
  const resourceName = legacy
    ? `${workerName}-${previewName}`
    : previewResourceName(workerName, branch);
  const databases = await list('/d1/database', databaseSchema);
  const namespaces = await list('/storage/kv/namespaces', namespaceSchema);
  const database = databases.find((item) => item.name === resourceName);
  const namespace = namespaces.find((item) => item.title === resourceName);

  if (action === 'prepare') {
    const db =
      database ??
      databaseSchema.parse(
        await api('/d1/database', 'POST', { name: resourceName, primary_location_hint: 'weur' }),
      );
    const kv =
      namespace ??
      namespaceSchema.parse(await api('/storage/kv/namespaces', 'POST', { title: resourceName }));
    const buckets = z
      .object({ buckets: z.array(z.object({ name: z.string() })) })
      .parse(await api('/r2/buckets'));
    if (!buckets.buckets.some((bucket) => bucket.name === resourceName)) {
      await api('/r2/buckets', 'POST', { name: resourceName, locationHint: 'weur' });
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
          previews: bindings,
        },
        null,
        2,
      ),
    );
    await Bun.write(
      '.wrangler-preview-migrations.json',
      JSON.stringify({ account_id: rawConfig.account_id, d1_databases: bindings.d1_databases }),
    );
    await run([
      'bunx',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--remote',
      '--config',
      '.wrangler-preview-migrations.json',
    ]);
    console.log(`Prepared isolated resources for ${previewName}: ${resourceName}`);
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
    const previewPath = `/workers/workers/${workerName}/previews/${encodeURIComponent(previewName)}`;
    const preview = z
      .object({ slug: z.string() })
      .nullable()
      .parse(await api(previewPath));
    await cleanup(() => api(previewPath, 'DELETE'));
    if (preview)
      await cleanup(async () => {
        const child = Bun.spawn(['bunx', 'wrangler', 'containers', 'list', '--json'], {
          stdout: 'pipe',
          stderr: 'inherit',
        });
        const output = await new Response(child.stdout).text();
        if ((await child.exited) !== 0) throw new Error('Could not list container apps');
        const apps = z
          .array(z.object({ id: z.string(), name: z.string() }))
          .parse(JSON.parse(output));
        for (const app of apps.filter((item) =>
          item.name.startsWith(`${workerName}_${preview.slug}_`),
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
}
