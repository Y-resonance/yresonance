export interface AuthState {
  provider: 'clerk' | 'keycloak';
  userId: string | null;
  sessionId: string | null;
  orgId: string | null;
  name?: string;
  isAdmin?: boolean;
  expiresAt?: number;
}
