import { env } from 'cloudflare:workers';
import type { AnalyticsConfig } from './config';

export function analyticsConfig(): AnalyticsConfig | null {
  if (env.POSTHOG_ENABLED !== 'true') return null;
  if (!env.POSTHOG_PROJECT_TOKEN || !env.POSTHOG_HOST) {
    console.error(
      'PostHog tracking is enabled but POSTHOG_PROJECT_TOKEN or POSTHOG_HOST is missing.',
    );
    return null;
  }
  return {
    token: env.POSTHOG_PROJECT_TOKEN,
    host: env.POSTHOG_HOST,
    environment: env.APP_ENV,
  };
}
