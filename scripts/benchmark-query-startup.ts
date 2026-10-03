import { z } from 'zod';

const arguments_ = process.argv.slice(2);
const rounds = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .parse(arguments_.find((argument) => argument.startsWith('--rounds='))?.split('=')[1] ?? 9);
const images = arguments_.filter((argument) => !argument.startsWith('--'));
if (!images.length) {
  throw new Error(
    'Usage: bun scripts/benchmark-query-startup.ts [--rounds=9] <image> [other-image]',
  );
}

const containerState = z.object({
  StartedAt: z.iso.datetime({ offset: true }),
  Running: z.boolean(),
});
const containerInfo = z.object({
  State: containerState,
  NetworkSettings: z.object({
    Ports: z.object({ '8080/tcp': z.array(z.object({ HostPort: z.string() })).min(1) }),
  }),
});
const queryResponse = z.object({
  ok: z.literal(true),
  data: z.tuple([z.object({ answer: z.literal(42) })]),
  metrics: z.object({ queryDurationMs: z.number() }),
});

async function docker(...arguments_: string[]) {
  const child = Bun.spawn(['docker', ...arguments_], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`docker ${arguments_[0]} failed: ${stderr}`);
  return stdout.trim();
}

async function measure(image: string) {
  const id = await docker('create', '-p', '127.0.0.1::8080', image);
  try {
    await docker('start', id);
    const inspection = JSON.parse(await docker('inspect', '--format', '{{json .}}', id));
    const { State: state } = z.object({ State: containerState }).parse(inspection);
    if (!state.Running) throw new Error(`Container exited: ${await docker('logs', id)}`);
    const info = containerInfo.parse(inspection);
    const base = `http://127.0.0.1:${info.NetworkSettings.Ports['8080/tcp'][0]!.HostPort}`;
    const deadline = performance.now() + 20_000;
    while (true) {
      try {
        const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(100) });
        z.object({ ok: z.literal(true) }).parse(await response.json());
        break;
      } catch (error) {
        if (performance.now() >= deadline) throw error;
        await Bun.sleep(5);
      }
    }
    const readyFromStartMs = Date.now() - Date.parse(info.State.StartedAt);
    const startedAt = performance.now();
    const response = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'query', sql: 'SELECT 42 AS answer', parameters: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    const query = queryResponse.parse(await response.json());
    const firstQueryMs = performance.now() - startedAt;
    const logs = await docker('logs', id);
    const processStartup = logs.match(/processStartupMs:\s*([\d.]+)/)?.[1];
    return {
      image,
      readyFromStartMs,
      firstQueryMs,
      engineMs: query.metrics.queryDurationMs,
      ...(processStartup ? { processStartupMs: Number(processStartup) } : {}),
    };
  } finally {
    await docker('rm', '-f', id);
  }
}

const results: Awaited<ReturnType<typeof measure>>[] = [];
// Alternate ordering so a later image does not always benefit from warmer host caches.
for (let round = 0; round < rounds; round++) {
  const order = round % 2 === 0 ? images : [...images].reverse();
  for (const image of order) {
    const result = await measure(image);
    results.push(result);
    console.log(JSON.stringify({ round: round + 1, ...result }));
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

for (const image of images) {
  const rows = results.filter((row) => row.image === image);
  const processStartups = rows.flatMap((row) => row.processStartupMs ?? []);
  console.log(
    JSON.stringify({
      image,
      rounds,
      medianReadyFromStartMs: median(rows.map((row) => row.readyFromStartMs)),
      medianFirstQueryMs: median(rows.map((row) => row.firstQueryMs)),
      ...(processStartups.length ? { medianProcessStartupMs: median(processStartups) } : {}),
    }),
  );
}
