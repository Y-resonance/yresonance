import { z } from 'zod';
import { previewClickhouseDatabase } from './preview-config';

const configuration = z.object({
  CLICKHOUSE_PREVIEW_URL: z.url(),
  CLICKHOUSE_PREVIEW_USER: z.string().min(1),
  CLICKHOUSE_PREVIEW_PASSWORD: z.string().min(1),
  CLICKHOUSE_PREVIEW_ACCESS_CLIENT_ID: z.string().min(1),
  CLICKHOUSE_PREVIEW_ACCESS_CLIENT_SECRET: z.string().min(1),
});

// Build and cleanup credentials can only manage the preview database namespace.
export async function managePreviewClickhouse(action: 'prepare' | 'cleanup', branch: string) {
  const database = previewClickhouseDatabase(branch);
  if (
    !Object.keys(process.env).some(
      (key) => key.startsWith('CLICKHOUSE_PREVIEW_') && process.env[key],
    )
  )
    return;
  const parsed = configuration.safeParse(process.env);
  if (!parsed.success)
    throw new Error('ClickHouse preview provisioning configuration is incomplete.');
  const config = parsed.data;
  const url = new URL(config.CLICKHOUSE_PREVIEW_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))
    throw new Error('ClickHouse provisioning requires HTTPS.');
  url.searchParams.set('wait_end_of_query', '1');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': config.CLICKHOUSE_PREVIEW_USER,
      'X-ClickHouse-Key': config.CLICKHOUSE_PREVIEW_PASSWORD,
      'CF-Access-Client-Id': config.CLICKHOUSE_PREVIEW_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': config.CLICKHOUSE_PREVIEW_ACCESS_CLIENT_SECRET,
    },
    body:
      action === 'prepare'
        ? `CREATE DATABASE IF NOT EXISTS "${database}"`
        : `DROP DATABASE IF EXISTS "${database}" SYNC`,
    redirect: 'manual',
    signal: AbortSignal.timeout(40_000),
  });
  await response.body?.cancel();
  if (!response.ok || response.headers.has('X-ClickHouse-Exception-Code'))
    throw new Error(`ClickHouse preview ${action} failed for ${database}: HTTP ${response.status}`);
  console.info('yresonance.clickhouse_preview', { action, branch, database, outcome: 'success' });
}
