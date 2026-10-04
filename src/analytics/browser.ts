import posthog, { type PostHog } from 'posthog-js';
import { analyticsUrl, sanitizeAnalyticsProperties, type AnalyticsConfig } from './config';

let client: PostHog | undefined;

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

export function initializeBrowserAnalytics(config: AnalyticsConfig) {
  if (client) return client;
  posthog.init(config.token, {
    api_host: config.host,
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    capture_pageview: false,
    capture_pageleave: true,
    capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true },
    capture_performance: { web_vitals: true },
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    // Flags aren't used. Their first-touch person properties bypass before_send.
    advanced_disable_flags: true,
    logs: {
      serviceName: 'yresonance-web',
      environment: config.environment,
      // Logs add the raw current URL after this hook; explicit attributes override it.
      beforeSend: (log) => ({
        ...log,
        attributes: { ...log.attributes, 'url.full': analyticsUrl(window.location.href) ?? '' },
      }),
    },
    before_send: (event) => {
      if (!event) return event;
      event.properties = sanitizeAnalyticsProperties(event.properties);
      if (event.$set) event.$set = sanitizeAnalyticsProperties(event.$set);
      if (event.$set_once) event.$set_once = sanitizeAnalyticsProperties(event.$set_once);
      return event;
    },
  });
  posthog.register({ environment: config.environment });
  client = posthog;
  return posthog;
}
