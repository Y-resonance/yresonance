import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { AppShell } from '#/components/app-shell';
import { SignedIn, SignedOut } from '#/components/auth-gate';
import { LandingPage } from '#/components/landing-page';
import { LoadingState } from '#/components/request-state';
import { SiteFooter } from '#/components/site-footer';
import { landingFaqs, publicPageHead } from '#/lib/seo';
import { useAuthCapabilities } from '#/platform/index.ui';

const DashboardIndex = lazy(() => import('#/components/dashboard-index'));

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    ...publicPageHead('/'),
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: landingFaqs.map(({ question, answer }) => ({
            '@type': 'Question',
            name: question,
            acceptedAnswer: { '@type': 'Answer', text: answer },
          })),
        }),
      },
    ],
  }),
});

function Home() {
  const { landing } = useAuthCapabilities();
  return (
    <AppShell requireWorkspace>
      {landing ? (
        <SignedOut>
          <LandingPage />
          <SiteFooter />
        </SignedOut>
      ) : null}
      <SignedIn>
        <Suspense fallback={<LoadingState />}>
          <DashboardIndex />
        </Suspense>
      </SignedIn>
    </AppShell>
  );
}
