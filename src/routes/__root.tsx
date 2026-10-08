import { ClerkProvider } from '@clerk/tanstack-react-start';
import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { AnalyticsProvider } from '#/analytics/provider';
import { getAnalyticsConfig } from '#/analytics/config-function';
import { browserAnalytics } from '#/analytics/browser';

import appCss from '../styles.css?url';

export const Route = createRootRoute({
  loader: () => getAnalyticsConfig(),
  onCatch: (error) => browserAnalytics()?.captureException(error),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'yresonance' },
      {
        name: 'description',
        content: 'Create and share client reporting dashboards with yresonance.',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-4 text-muted-foreground">
        This address does not match a page on yresonance.
      </p>
      <Link to="/" className="mt-6 inline-block text-primary underline underline-offset-4">
        Back to home
      </Link>
    </main>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  const analytics = Route.useLoaderData();
  return (
    <html lang="en">
      <head>
        {/* Applies the stored theme (or the OS preference) before first paint,
            so a dark-mode visitor never sees a light flash. Must stay inline
            and ahead of hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
          <AnalyticsProvider config={analytics ?? null}>
            <TooltipProvider>
              {children}
              <Scripts />
            </TooltipProvider>
          </AnalyticsProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
