import { SignUp } from '@clerk/tanstack-react-start';
import { createFileRoute } from '@tanstack/react-router';
import { pageTitle } from '#/lib/page-title';

export const Route = createFileRoute('/sign-up/$')({
  component: Page,
  head: () => ({
    meta: [
      { title: pageTitle('Sign up') },
      {
        name: 'description',
        content: 'Create a yresonance account to build and share client reporting dashboards.',
      },
    ],
  }),
});

function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </div>
  );
}
