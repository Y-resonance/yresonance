import { createServerFn } from '@tanstack/react-start';
import { ANALYTICS_PROXY_PATH } from './config';

export const getAnalyticsConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { analyticsConfig } = await import('./config.server');
  const config = analyticsConfig();
  return config ? { ...config, host: ANALYTICS_PROXY_PATH } : null;
});
