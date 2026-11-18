# Authentication

Auth is one adapter slot with two halves. The `auth` entry in `cloud/yresonance.config.ts` selects
both at build time:

| Half | File for `auth: <name>()` | Contract | Supplies |
| --- | --- | --- | --- |
| Server | `src/platform/adapters/<name>.ts` | `PlatformConfig['auth']` in `src/platform/config.ts` | Request identity, user directory, request middleware |
| UI | `src/platform/adapters/<name>-ui.tsx` (default export) | `AuthUi` in `src/platform/ui.ts` | State, actions, capabilities |

The config imports server-only modules, so the browser cannot import it. The build reads the
adapter name from it instead and resolves `virtual:auth-ui` to the matching UI file
(`dev/auth-ui.ts`). Application code reads the UI half only through `src/platform/index.ui.ts`,
so the other provider's SDK stays out of the bundle. UI adapter files
are named `*-ui` because TanStack Start refuses `*.client.*` imports during server rendering.

The auth components are ours and the same for every provider: signed-in and signed-out gates,
user menu, sign-in action, get-access button and workspace gate. A provider keeps only its
credential forms and, with several workspaces, its workspace picker.

| | `clerk()` | `oidc()` |
| --- | --- | --- |
| Used by | Hosted yresonance | Self-hosted installs |
| Session | Clerk SDK | Encrypted, HTTP-only cookie owned by yresonance |
| Workspaces | Clerk organizations (`multiple`) | Exactly one (`single`) |
| Admin | Clerk role `org:admin` | Role in the access token |
| Directory | Clerk API | `users` table, filled at login |
| Sign-up | Follows the Clerk instance: public, waitlist or none | None |
| Landing page | Yes | No, signed-out visitors go to the login |

## Self-hosting with Keycloak or another OIDC provider

The `oidc()` adapter speaks standard OpenID Connect. Keycloak is the verified provider. Hosting
on Node or Bun does not exist yet, so the adapter is covered by tests and a manual run against
Keycloak, not by a deployed installation.

### Select the adapter

```ts
// cloud/yresonance.config.ts
import { oidc } from '../src/platform/adapters/oidc';
export default defineConfig({ /* ... */ auth: oidc() });
```

### Register the client

In Keycloak, create an OpenID Connect client in your realm:

- Client authentication on (a confidential client) with the standard flow enabled.
- Valid redirect URI: `https://<your-host>/auth/callback`
- Valid post logout redirect URI: `https://<your-host>/`

yresonance derives both URIs from the address it is reached at, so a reverse proxy must pass the
public scheme and host through.

### Settings

| Setting | Value |
| --- | --- |
| `OIDC_ISSUER_URL` | Issuer, for Keycloak `https://<keycloak>/realms/<realm>` |
| `OIDC_CLIENT_ID` | Client id |
| `OIDC_CLIENT_SECRET` | Client secret |
| `OIDC_SESSION_SECRET` | Long random value that encrypts the session cookie. Changing it signs everyone out. |
| `OIDC_ADMIN_ROLE` | Optional role name, default `yresonance-admin` |

### Users and the admin role

Users, passwords and roles are managed in the provider, not in yresonance.

- Everyone who can log in to the client is an editor in the single workspace. Restrict who can
  log in on the provider side.
- Create a realm role named `yresonance-admin` and assign it to make a user a workspace admin.
  The role is read from the access token: Keycloak's `realm_access.roles`, the client's
  `resource_access.<client id>.roles`, or a flat `roles` claim. Keycloak adds realm roles to the
  access token by default. A provider that issues opaque access tokens has no admins.
- The `email` claim is trusted as issued; yresonance does not check `email_verified`. An
  address belongs to whoever signed in with it last.
- A dashboard can only be shared by email with someone who has signed in once. yresonance records
  users at login and needs no admin API credentials for the provider.

### Session behaviour

- Login is the authorization code flow with PKCE. `/auth/login`, `/auth/callback` and
  `/auth/logout` are answered by the adapter's request middleware; a Clerk build has none of them.
- The cookie holds the refresh token, the ID token and a snapshot of the user and admin flag.
  When the access token expires, the next request refreshes it. Role changes and removed users
  therefore take effect at that refresh, not instantly. Backchannel logout is not implemented.
- A rejected refresh signs the user out. An unreachable provider fails only that request.
  Parallel requests each refresh on their own, so a provider that rotates refresh tokens and
  rejects reuse (Keycloak's "Revoke Refresh Token") can sign a user out. Leave that option off.
- Sign-out posts to `/auth/logout` and ends the provider session too.
- Signed-out page visits are redirected to the login and return to the requested page.
  Unlisted share links (`/share/...`), the legal pages, health checks and API routes stay
  reachable; the API answers `401` on its own.
- Moving an existing Clerk installation's data to an OIDC provider is not supported.
