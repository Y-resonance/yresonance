declare namespace Cloudflare {
  interface Env {
    CLERK_SECRET_KEY?: string;
    AUTH_PROVIDER?: string;
    AUTH_APP_URL?: string;
    AUTH_SESSION_SECONDS?: string;
    KEYCLOAK_ISSUER?: string;
    KEYCLOAK_CLIENT_ID?: string;
    KEYCLOAK_CLIENT_SECRET?: string;
  }
}
