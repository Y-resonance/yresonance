import ui from '../../cloud/yresonance.ui';

// The app's only entry to the UI half of the selected auth adapter. Importing an adapter anywhere else
// would pull that provider's SDK into every build.
export const {
  Provider: AuthProvider,
  useAuth,
  useAuthActions,
  useAuthCapabilities,
  SignInForm,
  SignUpForm,
  WorkspaceSetup,
} = ui;
