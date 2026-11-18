import { createServerFn } from '@tanstack/react-start';

// Providers with a browser SDK resolve identity there and answer null here.
export const getBrowserSession = createServerFn({ method: 'GET' }).handler(async () => {
  const { platform } = await import('./index.server');
  return (await platform.auth.browserSession?.()) ?? null;
});
