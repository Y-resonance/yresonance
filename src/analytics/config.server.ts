import { settings } from '#/platform/settings';
import { posthogHosts, type AnalyticsConfig } from './config';

export function analyticsConfig(): AnalyticsConfig | null {
  if (settings().POSTHOG_ENABLED !== 'true') return null;
  if (!settings().POSTHOG_PROJECT_TOKEN || !settings().POSTHOG_HOST) {
    console.error(
      'PostHog tracking is enabled but POSTHOG_PROJECT_TOKEN or POSTHOG_HOST is missing.',
    );
    return null;
  }
  return {
    token: settings().POSTHOG_PROJECT_TOKEN,
    host: settings().POSTHOG_HOST,
    uiHost: posthogHosts(settings().POSTHOG_HOST).uiHost,
    environment: settings().APP_ENV,
  };
}
