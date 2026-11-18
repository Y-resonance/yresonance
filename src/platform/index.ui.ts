import ui from 'virtual:auth-ui';

// The app's only entry to the UI half of the auth adapter. The build resolves `virtual:auth-ui`
// to the adapter named by `auth` in the deployment config (see auth-ui-alias.ts), so only that
// provider's SDK reaches the bundle.
export const {
  Provider: AuthProvider,
  useAuth,
  useAuthActions,
  useAuthCapabilities,
  SignInForm,
  SignUpForm,
  WorkspaceSetup,
} = ui;
