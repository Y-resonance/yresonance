import {
  ClerkProvider,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useUser,
} from '@clerk/tanstack-react-start';
import { defineAuthUi } from '../ui';
import { useSignUpMode } from './clerk-sign-up-mode';
import { ClerkWorkspaceSetup } from './clerk-workspaces';

/** UI half of the Clerk adapter. Clerk's SDK owns the session; workspaces are organizations. */
export default defineAuthUi({
  Provider: ({ children }) => (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      {children}
    </ClerkProvider>
  ),
  useAuth() {
    const { isLoaded, isSignedIn, userId, orgId, sessionId } = useAuth();
    const { user } = useUser();
    return {
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      userId: userId ?? null,
      orgId: orgId ?? null,
      sessionId: sessionId ?? null,
      user: user
        ? {
            name: user.fullName ?? user.username,
            email: user.primaryEmailAddress?.emailAddress ?? null,
            imageUrl: user.imageUrl,
          }
        : null,
    };
  },
  useAuthActions() {
    const clerk = useClerk();
    const signUp = useSignUpMode();
    return {
      signIn: (redirectUrl) =>
        clerk.openSignIn({
          forceRedirectUrl: redirectUrl,
          signUpForceRedirectUrl: redirectUrl,
          withSignUp: signUp === 'public',
        }),
      getAccess: (redirectUrl) =>
        signUp === 'waitlist'
          ? clerk.openWaitlist()
          : clerk.openSignUp({
              forceRedirectUrl: redirectUrl,
              signInForceRedirectUrl: redirectUrl,
            }),
      signOut: () => void clerk.signOut(),
      manageAccount: () => clerk.openUserProfile(),
    };
  },
  useAuthCapabilities: () => ({
    signUp: useSignUpMode(),
    workspaces: 'multiple',
    landing: true,
  }),
  SignInForm: () => <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/" />,
  SignUpForm: () => <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/" />,
  WorkspaceSetup: ClerkWorkspaceSetup,
});
