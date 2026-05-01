# NusaNexus Router — Hybrid Auth Workspace Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router currently has a working Supabase-backed thin slice and a minimal `/dashboard` page. API routes can persist provider connections and generate router API keys, but workspace resolution still primarily depends on `DEV_WORKSPACE_ID`.

This design introduces a thin Supabase Auth slice with hybrid workspace resolution. It keeps the current internal `users`, `workspaces`, and `workspace_members` tables while mapping authenticated Supabase users into the internal data model.

## Goals

- Add minimal `/login` and `/signup` pages using Supabase email/password auth.
- Resolve workspaces from an authenticated Supabase browser session in API routes.
- Auto-create an internal user, personal workspace, and owner membership on first authenticated use.
- Keep `DEV_WORKSPACE_ID` as a local fallback when no bearer session is present.
- Keep the existing `/dashboard` provider/API-key flow working with authenticated requests.
- Avoid full team management, invitations, RLS policy design, or polished auth UX in this slice.

## Non-Goals

- Full production cookie/SSR auth.
- Team invite and role management UI.
- Multiple workspace switcher UI.
- Password reset flow.
- OAuth social login.
- RLS policy hardening.
- Removing `DEV_WORKSPACE_ID` entirely.

## Existing Schema

The current schema already supports the hybrid model:

```text
users
workspaces
workspace_members
```

Mapping from Supabase Auth to internal user:

```text
auth.users.id -> users.auth_provider_id
auth.users.email -> users.email
users.auth_provider = 'supabase'
```

This avoids destructive schema changes and uses the existing `auth_provider` fields as intended.

## Auth Model

Supabase Auth is the source of truth for browser login/session. The internal `users` table represents the application user profile used by workspace ownership and membership.

For this MVP slice, browser pages forward the Supabase access token to server API routes with:

```http
Authorization: Bearer <supabase_access_token>
```

Server API routes verify that token with Supabase Auth before resolving the workspace.

This deliberately avoids cookie adapter complexity while still validating real Supabase sessions.

## Pages

Add:

```text
/login
/signup
```

Both pages are simple client forms.

### `/signup`

- Collect email/password.
- Call Supabase Auth signup.
- If a session is returned immediately, call `/api/auth/bootstrap` with bearer token.
- If no session is returned because email confirmation is enabled, show a message asking the user to confirm email and then log in.

### `/login`

- Collect email/password.
- Call Supabase Auth sign-in.
- Call `/api/auth/bootstrap` with bearer token.
- Show success with a link to `/dashboard`, or redirect to `/dashboard` if implemented simply.

## Browser Supabase Client

Create:

```text
apps/web/lib/supabase-browser.js
```

Responsibilities:

- Read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Create a browser Supabase client via `@supabase/supabase-js`.
- Fail clearly when env is missing.

## Server Auth Helper

Create:

```text
apps/web/lib/auth.js
```

Responsibilities:

- Extract `Authorization: Bearer <token>` from a Next.js request.
- Verify token by calling Supabase Auth:

```text
GET <supabase_url>/auth/v1/user
apikey: <anon_key>
Authorization: Bearer <token>
```

- Return `null` when no bearer token is provided.
- Throw `invalid_session` when a bearer token is provided but Supabase rejects it.

Expected return shape:

```js
{
  id: '<supabase auth user id>',
  email: 'user@example.com'
}
```

## Hybrid Workspace Resolver

Update:

```text
apps/web/lib/workspace.js
```

New API:

```js
export async function resolveWorkspaceId(request)
```

Algorithm:

1. Try to resolve authenticated Supabase user from request bearer token.
2. If authenticated:
   - Find internal `users` row by:
     ```text
     auth_provider = 'supabase'
     auth_provider_id = supabaseUser.id
     ```
   - If none exists, create internal `users` row.
   - Find the first workspace membership for the internal user.
   - If none exists:
     - Create a personal workspace.
     - Create `workspace_members` row with role `owner`.
   - Return the workspace id.
3. If unauthenticated and `DEV_WORKSPACE_ID` exists, return it as a local fallback.
4. Otherwise throw `workspace_not_resolved` with status 401.

Personal workspace defaults:

```text
name = "<email prefix>'s Workspace"
slug = normalized email prefix + short random suffix
role = owner
```

Slug generation only needs to be unique enough for MVP. On insert conflict, retrying with a new suffix is acceptable.

## Bootstrap Route

Add:

```text
apps/web/app/api/auth/bootstrap/route.js
```

Behavior:

- Requires a valid bearer token.
- Calls `resolveWorkspaceId(request)`.
- Returns:

```json
{
  "workspace_id": "...",
  "status": "ready"
}
```

This lets `/login` and `/signup` explicitly create/resolve internal workspace state before the user opens the dashboard.

## Existing API Route Updates

Update:

```text
apps/web/app/api/providers/route.js
apps/web/app/api/endpoint/keys/route.js
```

Change workspace resolution from:

```js
const workspaceId = resolveWorkspaceId();
```

to:

```js
const workspaceId = await resolveWorkspaceId(request);
```

The rest of each route stays the same.

## Dashboard Update

Update:

```text
apps/web/app/dashboard/dashboard-client.jsx
```

Before calling control-plane APIs, fetch the current Supabase session from the browser client. If a session exists, include:

```http
Authorization: Bearer <session.access_token>
```

If no session exists, omit the header. This preserves local `DEV_WORKSPACE_ID` fallback.

The dashboard should also include simple links to `/login` and `/signup`, or a small note that authenticated mode is available.

## Error Handling

Expected API error codes:

- `workspace_not_resolved`: no valid session and no `DEV_WORKSPACE_ID` fallback.
- `invalid_session`: bearer token exists but Supabase rejects it.
- `configuration_error`: required Supabase env is missing.
- `persistence_error`: Supabase REST operations fail.

Auth pages should show human-readable error messages and avoid logging sensitive tokens.

## Environment Variables

Web/client:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_ROUTER_BASE_URL=http://localhost:8080
```

Web/server:

```env
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=
DEV_WORKSPACE_ID= # optional local fallback
```

## Testing Strategy

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Add focused tests where practical for pure helper behavior:

- bearer token extraction
- slug normalization
- fallback workspace behavior

Because this app currently has no test runner configured for the web workspace, helper checks can be performed with Node import commands unless a lightweight test runner is added later.

## Acceptance Criteria

This slice is complete when:

- `/login` builds and can sign in with Supabase email/password.
- `/signup` builds and can sign up with Supabase email/password.
- `/api/auth/bootstrap` resolves or creates internal user/workspace membership for authenticated users.
- `/api/providers` and `/api/endpoint/keys` resolve workspace from bearer session.
- `DEV_WORKSPACE_ID` still works as local fallback when no bearer token exists.
- `/dashboard` sends bearer token when a browser session exists.
- Web lint/build pass.
- Existing Go tests pass.
