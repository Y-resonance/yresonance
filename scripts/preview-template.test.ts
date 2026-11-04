import { describe, expect, it } from 'vitest';
import { readPreviewTemplate } from './preview-template';

describe('branch preview template', () => {
  it('reads the preview bindings that branch previews are provisioned from', () => {
    const { workerName, accountId, template } = readPreviewTemplate();

    expect(workerName).toBe('yresonance');
    expect(accountId).toMatch(/^[0-9a-f]{32}$/);
    expect(template.vars).toMatchObject({ APP_ENV: 'preview', POSTHOG_ENABLED: 'false' });
    expect(template.analytics_engine_datasets).toEqual([
      { binding: 'PRODUCT_ANALYTICS', dataset: 'yresonance_product_preview' },
    ]);
    expect(template.containers).toEqual([
      expect.objectContaining({ class_name: 'QueryEngineContainer', image: './Dockerfile' }),
    ]);
    expect(template.durable_objects?.bindings).toEqual([
      { name: 'QUERY_ENGINE', class_name: 'QueryEngineContainer' },
    ]);
  });
});
