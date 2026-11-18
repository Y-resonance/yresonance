import type { ComponentType, ReactNode } from 'react';

export interface AuthUser {
  name: string | null;
  email: string | null;
  imageUrl: string | null;
}

export interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  orgId: string | null;
  // Changes whenever the identity changes, so browser caches keyed by it never cross sessions.
  sessionId: string | null;
  user: AuthUser | null;
}

/** Identity resolved on the server for providers without a browser SDK. */
export interface BrowserSession {
  userId: string;
  orgId: string;
  sessionId: string;
  user: AuthUser;
}

export interface AuthActions {
  signIn(redirectUrl: string): void;
  /** Opens sign-up or the waitlist, whichever the `signUp` capability advertises. */
  getAccess(redirectUrl: string): void;
  signOut(): void;
  /** Absent when the provider has no account page to open. */
  manageAccount?(): void;
}

export interface AuthCapabilities {
  signUp: 'public' | 'waitlist' | 'none';
  workspaces: 'multiple' | 'single';
  landing: boolean;
}

/**
 * UI half of an auth adapter. It renders on the server and in the browser. The application owns every auth component and builds it from
 * these hooks; only credential forms and workspace selection stay with the provider.
 */
export interface AuthUi {
  Provider: ComponentType<{ session: BrowserSession | null; children: ReactNode }>;
  useAuth(): AuthState;
  useAuthActions(): AuthActions;
  useAuthCapabilities(): AuthCapabilities;
  /** Embedded credential forms. Without them, /sign-in and /sign-up call `signIn`. */
  SignInForm?: ComponentType;
  SignUpForm?: ComponentType;
  /** Shown to a signed-in user without an active workspace when `workspaces` is 'multiple'. */
  WorkspaceSetup?: ComponentType<{ fallback: ReactNode }>;
}

export function defineAuthUi(ui: AuthUi): AuthUi {
  return ui;
}
