import { createFileRoute } from '@tanstack/react-router';
import { SignInRedirect } from '#/components/auth-actions';
import { pageTitle } from '#/lib/page-title';
import { SignUpForm } from '#/platform/index.ui';

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
      {SignUpForm ? <SignUpForm /> : <SignInRedirect />}
    </div>
  );
}
