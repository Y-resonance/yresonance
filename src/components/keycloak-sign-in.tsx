import { useLocation } from '@tanstack/react-router';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

export function KeycloakSignIn() {
  const search = useLocation({ select: (location) => location.searchStr });
  const failed = new URLSearchParams(search).get('error') === 'login_failed';
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-20">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            Sign-in failed. Try again or ask your administrator to check your account and verified
            email.
          </AlertDescription>
        </Alert>
      ) : (
        <p>Use your Keycloak account to continue.</p>
      )}
      <Button nativeButton={false} render={<a href="/api/auth/login" />}>
        Continue with Keycloak
      </Button>
    </main>
  );
}
