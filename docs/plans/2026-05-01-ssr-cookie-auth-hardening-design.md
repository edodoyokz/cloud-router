# NusaNexus Router — SSR/Cookie Auth Hardening Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router currently has a thin hybrid auth/workspace flow:

- Supabase browser login/signup.
- Browser forwards Supabase access token to API routes as:

```http
Authorization: Bearer <supabase_access_token>
```

- API routes resolve workspace from the bearer token when present.
- `DEV_WORKSPACE_ID` remains a local fallback when no bearer session exists.
- `/dashboard` is not protected server-side yet.

This slice hardens auth for production by adding Supabase cookie/SSR session support while preserving the existing bearer flow and dev fallback.

## Goals

- Add server-side Supabase cookie session support.
- Add auth callback route for code/session exchange.
- Add middleware protection for `/dashboard`.
- Let API auth resolve users from either bearer token or cookie session.
- Keep bearer-token API compatibility.
- Keep `DEV_WORKSPACE_ID` fallback for local/dev API calls.
- Remove/replace outdated dashboard dev-warning copy.
- Update docs.

## Non-Goals

- Full cookie-only migration.
- Removing bearer-token forwarding from dashboard.
- Server-rendering dashboard data.
- Workspace switcher.
- Team invites.
- OAuth provider UI.
- Password reset flow.
- Role-based dashboard authorization beyond requiring a session.
- Custom refresh-token rotation logic.

## Auth Resolution Order

API routes should resolve authenticated user in this order:

1. `Authorization: Bearer <token>` header.
2. Supabase cookie session token.
3. No authenticated user.

Workspace resolution should remain:

1. authenticated user -> internal user -> personal workspace
2. fallback to `DEV_WORKSPACE_ID` if no authenticated user
3. otherwise return `401 workspace_not_resolved`

`requireAuthenticatedWorkspaceContext()` should require bearer or cookie auth and must not use dev fallback.

## Supabase SSR/Cookie Support

Add dependency:

```text
@supabase/ssr
```

Add server helper:

```text
apps/web/lib/supabase-server.js
```

Expected helpers:

```js
createSupabaseServerClient()
createSupabaseMiddlewareClient(request)
```

These helpers use Next.js cookies APIs and Supabase SSR adapters.

## Auth Callback Route

Add:

```text
apps/web/app/auth/callback/route.js
```

Behavior:

- Read `code` and optional `next` query params.
- Exchange code for session via Supabase SSR client.
- Redirect to `next` if safe relative path, otherwise `/dashboard`.
- On error, redirect to `/login?error=auth_callback_failed`.

This supports email confirmation/OAuth-style callbacks and future provider additions.

## Middleware

Add:

```text
apps/web/middleware.js
```

Protect:

```text
/dashboard
/dashboard/:path*
```

Behavior:

- Create Supabase middleware client.
- Check session/user.
- If missing, redirect to:

```text
/login?next=/dashboard
```

- If present, allow request.
- Keep API routes public to route-level auth logic.

## Login/Signup UX

Current browser login/signup may remain mostly unchanged.

Optional improvement:

- Respect `next` query param after login.
- Success link should point to `next || /dashboard`.

The primary requirement is not breaking login/signup.

## Dashboard Copy

Current dashboard page says:

```text
Dev mode: this dashboard uses DEV_WORKSPACE_ID until Supabase Auth is wired.
```

Replace with neutral production-safe copy:

```text
Authenticated sessions use Supabase cookies. Local API calls may still use DEV_WORKSPACE_ID fallback when no session is present.
```

## API Compatibility

Existing dashboard code can continue forwarding bearer tokens.

API route auth helpers should additionally check cookie sessions when bearer is absent. This makes direct same-origin API calls work in authenticated browser sessions even without explicit bearer forwarding.

## Security Notes

- Middleware protects only browser dashboard access.
- API routes still enforce workspace resolution independently.
- Dev fallback remains explicit as `auth_mode: dev_fallback`.
- Cookie session is managed by Supabase SSR helper.
- Redirect `next` must be same-origin relative path only.

## Acceptance Criteria

- `@supabase/ssr` dependency is installed.
- `/dashboard` redirects unauthenticated users to `/login?next=/dashboard`.
- Authenticated cookie session can access `/dashboard`.
- API routes still accept bearer token auth.
- API routes can resolve authenticated user from cookie session when bearer is missing.
- `DEV_WORKSPACE_ID` fallback still works for non-authenticated local/dev API calls.
- Auth callback route exists.
- Dashboard copy no longer says Supabase Auth is not wired.
- Docs/backlog updated.
- `npm run lint:web` passes.
- `npm run build:web` passes.
- `cd services/router && go test ./...` passes.
