# NusaNexus Router — Workspace/Auth Polish Thin Slice Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router currently has a functional MVP control plane:

- Supabase Auth login/signup.
- Hybrid workspace auto-create.
- Browser forwards Supabase access token as `Authorization: Bearer <token>`.
- API routes resolve workspace from bearer token or fall back to `DEV_WORKSPACE_ID` in local/dev mode.
- Dashboard can manage providers/API keys, usage, health checks, and default fallback chain.

However, the dashboard does not clearly show:

- who is signed in,
- which workspace is being edited,
- whether it is using authenticated workspace mode or dev fallback mode,
- how to sign out.

This slice improves auth/workspace clarity without replacing the current bearer-token MVP with full SSR/cookie auth.

## Goals

- Add `GET /api/workspaces/current`.
- Return current workspace context for authenticated sessions.
- Return explicit dev fallback context when no bearer token exists and `DEV_WORKSPACE_ID` is configured.
- Show current user/workspace/mode in dashboard.
- Add dashboard sign-out button.
- Keep existing `DEV_WORKSPACE_ID` fallback for local development.
- Preserve existing API route behavior by keeping `resolveWorkspaceId(request)` compatible.

## Non-Goals

- Full production SSR cookie auth.
- Middleware route protection.
- Removing `DEV_WORKSPACE_ID`.
- Multi-workspace switching.
- Team workspace creation/invites.
- Workspace settings page.
- Server-side Supabase session cookies.

## API Design

### `GET /api/workspaces/current`

Returns workspace context for the current request.

Request:

```http
GET /api/workspaces/current
Authorization: Bearer <supabase_access_token>
```

### Authenticated Response

```json
{
  "id": "uuid",
  "name": "alice's Workspace",
  "slug": "alice-abc123",
  "role": "owner",
  "auth_mode": "authenticated",
  "user": {
    "email": "alice@example.com"
  }
}
```

### Dev Fallback Response

When no bearer token is provided and `DEV_WORKSPACE_ID` is configured:

```json
{
  "id": "dev-workspace-id",
  "name": "Development Workspace",
  "slug": null,
  "role": "dev",
  "auth_mode": "dev_fallback",
  "user": null
}
```

### Errors

- `401 workspace_not_resolved` when no session and no `DEV_WORKSPACE_ID`.
- `401 invalid_session` for invalid Supabase bearer token.
- `500 persistence_error` for Supabase failures.
- `500 configuration_error` for missing Supabase Auth env when a bearer token is present.

## Workspace Helper Design

Add richer workspace context helper in:

```text
apps/web/lib/workspace.js
```

Suggested exports:

```js
export async function resolveWorkspaceContext(request) {}
export async function requireAuthenticatedWorkspaceContext(request) {}
```

Keep existing exports:

```js
export async function resolveWorkspaceId(request) {}
export async function requireAuthenticatedWorkspaceId(request) {}
```

`resolveWorkspaceId(request)` should delegate to `resolveWorkspaceContext(request)` and return `context.workspace.id`, preserving existing API routes.

### Authenticated Context Behavior

If a valid bearer session exists:

1. Read Supabase Auth user via existing `getAuthenticatedUser(request)`.
2. Ensure internal user exists.
3. Ensure personal workspace exists.
4. Fetch workspace details and membership role.
5. Return:

```js
{
  workspace: {
    id,
    name,
    slug
  },
  role,
  auth_mode: 'authenticated',
  user: {
    id: authUser.id,
    email: authUser.email
  }
}
```

### Dev Fallback Context Behavior

If no bearer session exists:

1. If `DEV_WORKSPACE_ID` exists, return dev fallback context.
2. Otherwise throw `workspace_not_resolved`.

Dev fallback context:

```js
{
  workspace: {
    id: process.env.DEV_WORKSPACE_ID,
    name: 'Development Workspace',
    slug: null
  },
  role: 'dev',
  auth_mode: 'dev_fallback',
  user: null
}
```

## Dashboard UX

Replace the current generic "Authenticated mode" card with a Workspace card.

### Authenticated Mode

Show:

```text
Workspace
Signed in as alice@example.com
Workspace: alice's Workspace
Role: owner
Mode: authenticated
[Log out]
```

### Dev Fallback Mode

Show:

```text
Workspace
Mode: dev fallback
Workspace: Development Workspace
Workspace ID: <DEV_WORKSPACE_ID>
Log in to use authenticated workspace.
[Log in] [Sign up]
```

### Loading/Error States

Use independent state so workspace context loading errors do not break provider/key/usage/preset sections:

- `workspaceContext`
- `workspaceStatus`
- `loadingWorkspace`

The dashboard should load workspace context on mount using the same async/cancelled effect pattern used elsewhere to avoid React lint errors.

## Sign Out Behavior

Add a `Sign out` button in authenticated mode.

Client behavior:

```js
const supabase = getSupabaseBrowserClient();
await supabase.auth.signOut();
window.location.href = '/login';
```

If sign out fails, show a dashboard-local workspace/auth error.

## Existing API Header Strategy

Keep current MVP browser header strategy:

```http
Authorization: Bearer <supabase_access_token>
```

Do not migrate to SSR/cookies in this slice.

## Security Constraints

- Do not expose service-role keys client-side.
- Do not expose provider credentials/API key hashes/raw keys.
- Authenticated context must only return workspace where internal user has membership.
- Dev fallback must be explicitly labeled `dev_fallback` in API and UI.

## Testing Strategy

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual smoke test:

1. Open `/dashboard` without login but with `DEV_WORKSPACE_ID` configured.
2. Confirm Workspace card shows dev fallback mode.
3. Log in through `/login`.
4. Confirm Workspace card shows signed-in email and workspace name.
5. Click Sign out.
6. Confirm redirect to `/login` and Supabase session cleared.

## Acceptance Criteria

This slice is complete when:

- `GET /api/workspaces/current` exists.
- Authenticated requests return user/workspace/role/auth mode.
- Dev fallback requests return explicit `dev_fallback` context.
- Existing API routes still resolve workspace IDs correctly.
- Dashboard shows current workspace/user/mode.
- Dashboard supports sign out.
- Web lint/build pass.
- Go tests pass.
