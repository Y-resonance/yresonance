# Authentication

`AUTH_PROVIDER` selects `clerk` (the default) or `keycloak` for the deployment.
Keycloak connects directly over OpenID Connect. Clerk credentials are unnecessary in Keycloak mode.
Only one provider is active per deployment.

## Keycloak setup

Create an OpenID Connect client in your realm:

- Enable client authentication and the standard authorization-code flow.
- Require PKCE with `S256`. Disable implicit flow and direct access grants for this client.
- Set the valid redirect URI to `https://<app-host>/api/auth/callback`.
- Set the valid post-logout redirect URI to `https://<app-host>`.
- Include `email`, `email_verified`, and profile claims in ID tokens. Users must have a verified email.
  Configure email verification in Keycloak or use an upstream provider that verifies email ownership.
- Use Keycloak's default RS256 ID-token signing algorithm.

Set these non-secret variables for the local dev server or build:

```sh
export AUTH_PROVIDER=keycloak
export AUTH_APP_URL=https://reports.example.com
export KEYCLOAK_ISSUER=https://sso.example.com/realms/reporting
export KEYCLOAK_CLIENT_ID=yresonance
export AUTH_SESSION_SECONDS=3600
```

`KEYCLOAK_ISSUER` is the realm's exact issuer URL, not its discovery URL.
`AUTH_APP_URL` is the application's canonical origin, without a path. Authentication routes reject
requests on other origins. For previews, use a separate client or explicitly allow that preview's
callback and logout URLs, and set its own `AUTH_APP_URL`.

Store `KEYCLOAK_CLIENT_SECRET` as a Worker secret in your deployment. Preserve the existing
`UPLOAD_SIGNING_SECRET`, which encrypts ID tokens with a separate purpose key. Vite forwards the
non-secret settings above into the generated Worker configuration and replaces the required Clerk
secret with `KEYCLOAK_CLIENT_SECRET`. Apply the committed D1 migrations before starting the app.

For local development, use `AUTH_APP_URL=http://localhost:3000` and the corresponding redirect and
logout URLs in Keycloak. Set `KEYCLOAK_CLIENT_SECRET` in your shell or ignored `.envrc`.
The dev server forwards it to the local Worker. HTTP is accepted only for loopback addresses in
`APP_ENV=development`. A remote Keycloak server still needs HTTPS. Run `bun run db:migrate:local`
and `bun run dev`.

## Workspaces and permissions

Keycloak identifies the person. yresonance owns workspaces, memberships, invitations, and admin roles.
Realm roles and Keycloak organizations do not grant application access.

Any signed-in Keycloak user can create a workspace and becomes its first admin. The Workspaces
menu lets users switch workspaces or accept invitations. Admins invite people by email, change
member/admin roles, revoke invitations, and remove members. At least one admin must remain.
Membership changes take effect on the next request, including already-open sessions.

Invitations expire after seven days and appear after the recipient signs in with the matching
verified email. The app does not send invitation emails. An admin must tell the recipient to sign
in. Invitation email addresses are case-insensitive. Invite admins only when they should have full
workspace access, including every dashboard and datasource administration.

Members need dashboard-specific viewer/editor grants. The existing dashboard sharing UI assigns
those grants after the person joins the workspace. Removing a member also deletes their dashboard
grants, so rejoining does not restore old permissions. Unlisted share links remain independent
read-only capabilities, as before.

The GUI and WebMCP use the same workspace API actions. Workspace tools are available on signed-in pages. Login and logout remain human-driven.

## Sessions and identity

Login uses authorization code, PKCE, state, nonce, and ID-token signature, issuer, audience, and
expiry validation through `openid-client`. Callbacks are bound to an HttpOnly browser cookie and a
single-use D1 record. Access tokens never reach the browser or application logs.

The browser holds an opaque HttpOnly, SameSite=Lax session cookie. HTTPS uses Secure cookies with
the `__Host-` prefix. D1 stores its SHA-256 hash, the selected workspace, expiry, and an encrypted
ID token used for RP-initiated logout. Login rotates the current session. The browser reloads at
session expiry and synchronizes account/workspace changes between tabs through a localStorage
identity marker; that marker cannot authenticate requests. Expired sessions and
login states are deleted when a new login starts.

App sessions have an absolute lifetime of one hour by default. `AUTH_SESSION_SECONDS` accepts
60 through 86400 seconds. The app does not store refresh tokens. Sessions expire independently of
Keycloak access-token expiry. Disabling a Keycloak user or signing out elsewhere does not revoke an
existing app session immediately; it ends on local logout or its configured expiry. Backchannel
logout is not implemented. Local logout revokes the app session before attempting Keycloak logout,
so an unavailable Keycloak server does not keep the app session alive.

Users are identified by the pair of issuer and subject, with local `kc_` user IDs. Email addresses
are used for invitations and collaborator lookup, never to merge identities. Existing Clerk IDs,
workspace keys, and grants remain unchanged. For backwards compatibility, some existing database
columns and sharing payload properties retain `clerk` in their names; in Keycloak mode user ID
values refer to local users, and workspace keys use the reserved `local:` prefix.

Switching a Clerk deployment to Keycloak creates separate identities and workspaces. It does not
transfer access to existing Clerk data. Migrating those users, memberships, and grants requires an
explicit mapping and migration.
