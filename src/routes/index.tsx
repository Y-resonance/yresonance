import { Show } from '@clerk/tanstack-react-start';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { AppShell } from '#/components/app-shell';
import { LandingPage } from '#/components/landing-page';
import { LoadingState } from '#/components/request-state';
import { landingFaqs, publicPageHead } from '#/lib/seo';

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
  return (
    <AppShell requireWorkspace>
      <Show when="signed-out">
        <LandingPage />
      </Show>
      <Show when="signed-in">
        <Suspense fallback={<LoadingState />}>
          <DashboardIndex />
        </Suspense>
      </Show>
    </AppShell>
  );
}
