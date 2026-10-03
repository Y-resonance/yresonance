import { expect, test as base } from '@playwright/test';

// UI coverage must remain runnable without Clerk credentials or any external browser service.
export const test = base.extend<{ localRequestsOnly: void }>({
  localRequestsOnly: [
    async ({ context, baseURL }, use) => {
      if (!baseURL) throw new Error('The UI suite requires a baseURL.');
      const origin = new URL(baseURL).origin;
      const externalRequests: string[] = [];
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).origin === origin) {
          await route.fallback();
        } else {
          externalRequests.push(url);
          await route.abort();
        }
      });
      await use();
      expect(externalRequests, 'UI tests must not depend on external services').toEqual([]);
    },
    { auto: true },
  ],
});
