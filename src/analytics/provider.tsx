import { useAuth } from '@clerk/tanstack-react-start';
import { PostHogProvider } from '@posthog/react';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, type ReactNode } from 'react';
import posthog from 'posthog-js';
import type { AnalyticsConfig } from './config';
import { initializeBrowserAnalytics } from './browser';

export function AnalyticsProvider({
  config,
  children,
}: {
  config: AnalyticsConfig | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const { isLoaded, userId, orgId } = useAuth();
  const lastPageview = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!config || !isLoaded) return;
    const client = initializeBrowserAnalytics(config);
    // Clerk owns identity. Reset before an account switch or logout.
    const previousUser = client.get_property('clerk_user_id');
    const previousOrg = client.get_property('workspace_id');
    if (previousUser && previousUser !== userId) client.reset();
    if (userId) {
      if (previousUser !== userId) client.identify(userId);
      client.register({ clerk_user_id: userId });
    }
    if (previousOrg !== orgId) client.unregister('workspace_id');
    if (orgId) client.register({ workspace_id: orgId });
    client.register({ environment: config.environment });
    const pageview = () => {
      if (lastPageview.current === window.location.href) return;
      lastPageview.current = window.location.href;
      client.capture('$pageview');
    };
    pageview();
    return router.subscribe('onResolved', pageview);
  }, [config, router, isLoaded, userId, orgId]);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
