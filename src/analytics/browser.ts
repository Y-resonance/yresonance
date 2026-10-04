import type { PostHog } from 'posthog-js';

let client: PostHog | undefined;

export function setBrowserAnalytics(value: PostHog) {
  client = value;
}

export function browserAnalytics() {
  return client;
}

export function analyticsHeaders(): Record<string, string> {
  if (!client || client.has_opted_out_capturing()) return {};
  return {
    'X-POSTHOG-DISTINCT-ID': client.get_distinct_id(),
    'X-POSTHOG-SESSION-ID': client.get_session_id(),
  };
}
