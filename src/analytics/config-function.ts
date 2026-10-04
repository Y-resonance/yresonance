import { createServerFn } from '@tanstack/react-start';

export const getAnalyticsConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { analyticsConfig } = await import('./config.server');
  return analyticsConfig();
});
