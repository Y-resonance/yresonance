import { createFileRoute } from '@tanstack/react-router';
import { SignInRedirect } from '#/components/auth-actions';
import { pageTitle } from '#/lib/page-title';
import { SignInForm } from '#/platform/index.ui';

export const Route = createFileRoute('/sign-in/$')({
  component: Page,
  head: () => ({
    meta: [
      { title: pageTitle('Sign in') },
      {
        name: 'description',
        content: 'Sign in to yresonance to access your reporting dashboards and workspace.',
      },
    ],
  }),
});

function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      {SignInForm ? <SignInForm /> : <SignInRedirect />}
    </div>
  );
}
