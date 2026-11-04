import { experimental_readRawConfig } from 'wrangler';
import { z } from 'zod';

// Branch previews are provisioned from the `previews` block of wrangler.jsonc. Wrangler only
// offers this read as an experimental API, so keep it here where a test covers each upgrade.
export function readPreviewTemplate() {
  const { rawConfig } = experimental_readRawConfig({ config: 'wrangler.jsonc' });
  const workerName = z.string().min(1).parse(rawConfig.name);
  const template = rawConfig.previews;
  if (!template || !rawConfig.account_id)
    throw new Error('Expected a previews block and a Cloudflare account ID.');
  return { rawConfig, workerName, accountId: rawConfig.account_id, template };
}
