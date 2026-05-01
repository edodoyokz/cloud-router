# Workspace/Auth Polish Thin Slice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `GET /api/workspaces/current` and improve dashboard auth/workspace UX by showing current user/workspace/auth mode and supporting sign out.

**Architecture:** Extend the existing workspace helper with a richer workspace context object while preserving `resolveWorkspaceId(request)` compatibility. Add a current-workspace API route. Extend the dashboard client with independent workspace context state and sign-out UI. Keep the current bearer-token MVP auth strategy; do not introduce SSR/cookie middleware in this slice.

**Tech Stack:** Next.js 16 App Router, React 19 dashboard client, Supabase Auth REST user endpoint, existing Supabase PostgREST admin helper, existing hybrid workspace resolver.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-workspace-auth-polish-design.md
```

Relevant files:

```text
apps/web/lib/auth.js
apps/web/lib/workspace.js
apps/web/lib/supabase-browser.js
apps/web/app/api/auth/bootstrap/route.js
apps/web/app/dashboard/dashboard-client.jsx
README.md
docs/API_CONTRACT.md
docs/AUTH_FLOW.md
docs/SETUP.md
docs/BACKLOG.md
```

Current behavior:

- `resolveWorkspaceId(request)` returns authenticated personal workspace ID or `DEV_WORKSPACE_ID` fallback.
- `requireAuthenticatedWorkspaceId(request)` requires Supabase bearer session.
- Dashboard forwards Supabase bearer token from browser session.
- Dashboard shows generic "Authenticated mode" copy but not current user/workspace.
- No `/api/workspaces/current` route exists.

Constraints:

- Do not remove `DEV_WORKSPACE_ID` fallback.
- Do not add SSR cookie auth/middleware.
- Existing provider/key/usage/preset API routes must keep working.
- Use async/cancelled effect pattern to avoid React `set-state-in-effect` lint errors.

---

## Task 1: Add workspace context helpers

**Files:**
- Modify: `apps/web/lib/workspace.js`

**Step 1: Add bearer detection import**

Current file imports `getAuthenticatedUser`:

```js
import { getAuthenticatedUser } from './auth.js';
```

Change to:

```js
import { bearerTokenFromRequest, getAuthenticatedUser } from './auth.js';
```

This lets us distinguish no-token dev fallback from invalid-token errors handled by `getAuthenticatedUser`.

**Step 2: Add `resolveWorkspaceContext`**

Add near top:

```js
export async function resolveWorkspaceContext(request) {
  const token = bearerTokenFromRequest(request);
  if (token) {
    const authUser = await getAuthenticatedUser(request);
    const appUser = await ensureInternalUser(authUser);
    const workspace = await ensurePersonalWorkspace(appUser, authUser.email);
    const membership = await getWorkspaceMembership(appUser.id, workspace.id);
    const details = await getWorkspaceDetails(workspace.id);

    return {
      workspace: {
        id: details.id,
        name: details.name,
        slug: details.slug
      },
      role: membership?.role || 'owner',
      auth_mode: 'authenticated',
      user: {
        id: authUser.id,
        email: authUser.email
      }
    };
  }

  const workspaceId = process.env.DEV_WORKSPACE_ID;
  if (!workspaceId) {
    const error = new Error('workspace could not be resolved');
    error.code = 'workspace_not_resolved';
    error.status = 401;
    throw error;
  }

  return {
    workspace: {
      id: workspaceId,
      name: 'Development Workspace',
      slug: null
    },
    role: 'dev',
    auth_mode: 'dev_fallback',
    user: null
  };
}
```

**Step 3: Update existing `resolveWorkspaceId`**

Replace current implementation with:

```js
export async function resolveWorkspaceId(request) {
  const context = await resolveWorkspaceContext(request);
  return context.workspace.id;
}
```

**Step 4: Add `requireAuthenticatedWorkspaceContext`**

Add:

```js
export async function requireAuthenticatedWorkspaceContext(request) {
  const authUser = await getAuthenticatedUser(request);
  if (!authUser) {
    throw Object.assign(new Error('authentication is required'), { status: 401, code: 'authentication_required' });
  }
  const appUser = await ensureInternalUser(authUser);
  const workspace = await ensurePersonalWorkspace(appUser, authUser.email);
  const membership = await getWorkspaceMembership(appUser.id, workspace.id);
  const details = await getWorkspaceDetails(workspace.id);

  return {
    workspace: {
      id: details.id,
      name: details.name,
      slug: details.slug
    },
    role: membership?.role || 'owner',
    auth_mode: 'authenticated',
    user: {
      id: authUser.id,
      email: authUser.email
    }
  };
}
```

**Step 5: Update `requireAuthenticatedWorkspaceId`**

Replace current implementation with:

```js
export async function requireAuthenticatedWorkspaceId(request) {
  const context = await requireAuthenticatedWorkspaceContext(request);
  return context.workspace.id;
}
```

**Step 6: Add detail helpers**

Add below `ensurePersonalWorkspace`:

```js
export async function getWorkspaceDetails(workspaceId) {
  const rows = await supabaseSelect('workspaces', `?id=eq.${encodeURIComponent(workspaceId)}&select=id,name,slug&limit=1`);
  if (rows.length === 0) {
    throw Object.assign(new Error('workspace not found'), { status: 404, code: 'workspace_not_found' });
  }
  return rows[0];
}

export async function getWorkspaceMembership(userId, workspaceId) {
  const rows = await supabaseSelect(
    'workspace_members',
    `?user_id=eq.${encodeURIComponent(userId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=role&limit=1`
  );
  return rows[0] || null;
}
```

**Step 7: Verify imports/lint**

Run:

```bash
npm run lint:web
```

Expected: PASS.

**Step 8: Commit**

```bash
git add apps/web/lib/workspace.js
git commit -m "feat: add workspace context resolver"
```

---

## Task 2: Add current workspace API route

**Files:**
- Create: `apps/web/app/api/workspaces/current/route.js`

**Step 1: Create route**

Create `apps/web/app/api/workspaces/current/route.js`:

```js
import { NextResponse } from 'next/server';
import { resolveWorkspaceContext } from '../../../../lib/workspace.js';

export async function GET(request) {
  try {
    const context = await resolveWorkspaceContext(request);
    return NextResponse.json({
      id: context.workspace.id,
      name: context.workspace.name,
      slug: context.workspace.slug,
      role: context.role,
      auth_mode: context.auth_mode,
      user: context.user ? { email: context.user.email } : null
    });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'workspace_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 2: Build route check**

Run:

```bash
npm run build:web
```

Expected routes include:

```text
/api/workspaces/current
```

**Step 3: Lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/app/api/workspaces/current/route.js
git commit -m "feat: add current workspace api"
```

---

## Task 3: Add dashboard workspace loading state

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add state**

Inside `DashboardClient`, near other state declarations, add:

```js
const [workspaceContext, setWorkspaceContext] = useState(null);
const [workspaceStatus, setWorkspaceStatus] = useState(null);
const [loadingWorkspace, setLoadingWorkspace] = useState(false);
```

**Step 2: Add `loadWorkspaceContext` callback**

Inside `DashboardClient`, after `authenticatedJsonHeaders`, add:

```js
const loadWorkspaceContext = useCallback(async function loadWorkspaceContext() {
  setLoadingWorkspace(true);
  setWorkspaceStatus(null);
  try {
    const response = await fetch('/api/workspaces/current', {
      headers: await authenticatedJsonHeaders()
    });
    const data = await parseJsonResponse(response, 'Failed to load workspace');
    setWorkspaceContext(data);
  } catch (error) {
    setWorkspaceStatus({ type: 'error', message: error.message || 'Failed to load workspace' });
  } finally {
    setLoadingWorkspace(false);
  }
}, [authenticatedJsonHeaders]);
```

**Step 3: Add initial effect with async boundary**

Do not call `loadWorkspaceContext()` directly from `useEffect`, because it sets state synchronously before await.

Use:

```js
useEffect(() => {
  let cancelled = false;

  async function loadInitialWorkspace() {
    try {
      const headers = await authenticatedJsonHeaders();
      if (cancelled) return;
      setLoadingWorkspace(true);
      setWorkspaceStatus(null);

      const response = await fetch('/api/workspaces/current', { headers });
      const data = await parseJsonResponse(response, 'Failed to load workspace');
      if (cancelled) return;
      setWorkspaceContext(data);
    } catch (error) {
      if (!cancelled) setWorkspaceStatus({ type: 'error', message: error.message || 'Failed to load workspace' });
    } finally {
      if (!cancelled) setLoadingWorkspace(false);
    }
  }

  loadInitialWorkspace();

  return () => {
    cancelled = true;
  };
}, [authenticatedJsonHeaders]);
```

**Step 4: Add signout handler**

Inside component:

```js
async function signOut() {
  setWorkspaceStatus(null);
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  } catch (error) {
    setWorkspaceStatus({ type: 'error', message: error.message || 'Failed to sign out' });
  }
}
```

**Step 5: Lint check**

```bash
npm run lint:web
```

If lint flags unused `loadWorkspaceContext` or `signOut`, either continue Task 4 before committing or use `loadWorkspaceContext` in the Workspace card refresh button.

**Step 6: Commit**

If lint passes:

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: load dashboard workspace context"
```

If unused functions require UI, combine with Task 4 commit.

---

## Task 4: Render dashboard Workspace card

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Replace current Authenticated mode section**

Current dashboard starts with a section like:

```jsx
<section style={cardStyle}>
  <strong>Authenticated mode</strong>
  <p ...>Log in to resolve workspace...</p>
  <div ...>
    <a href="/login">Log in</a>
    <a href="/signup">Sign up</a>
  </div>
</section>
```

Replace it with:

```jsx
<section style={cardStyle}>
  <div>
    <h2 style={{ margin: 0 }}>Workspace</h2>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Current control-plane workspace context.</p>
  </div>

  {workspaceStatus ? <StatusMessage status={workspaceStatus} /> : null}
  {loadingWorkspace ? <p>Loading workspace…</p> : null}

  {workspaceContext ? (
    <div style={{ display: 'grid', gap: 8 }}>
      <span>Mode: {workspaceContext.auth_mode}</span>
      <span>Workspace: {workspaceContext.name}</span>
      <span>Workspace ID: <code>{workspaceContext.id}</code></span>
      {workspaceContext.slug ? <span>Slug: {workspaceContext.slug}</span> : null}
      <span>Role: {workspaceContext.role}</span>
      {workspaceContext.user?.email ? <span>Signed in as: {workspaceContext.user.email}</span> : null}
      {workspaceContext.auth_mode === 'dev_fallback' ? <p style={{ margin: 0, color: '#92400e' }}>Using DEV_WORKSPACE_ID fallback. Log in to use an authenticated workspace.</p> : null}
    </div>
  ) : null}

  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    {workspaceContext?.auth_mode === 'authenticated' ? (
      <button style={buttonStyle} type="button" onClick={signOut}>Log out</button>
    ) : (
      <>
        <a href="/login">Log in</a>
        <a href="/signup">Sign up</a>
      </>
    )}
    <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={loadWorkspaceContext} disabled={loadingWorkspace}>
      Refresh workspace
    </button>
  </div>
</section>
```

**Step 2: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: show workspace context in dashboard"
```

---

## Task 5: Update docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/AUTH_FLOW.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: README**

Add current thin slice bullet:

```md
- Dashboard shows current workspace/auth mode and supports sign out
```

Update next build steps:

```md
## Next Build Steps
1. Add token/cost accounting improvements
2. Add provider reconnect flow
3. Add richer onboarding snippets for Claude Code / Codex / OpenClaw / Cursor
4. Add production SSR/cookie auth hardening
```

**Step 2: API contract**

Add/update `GET /api/workspaces/current` section:

```md
### `GET /api/workspaces/current`
Returns the active workspace context.

**Response `200` authenticated**
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

**Response `200` dev fallback**
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
```

**Step 3: AUTH_FLOW**

Document that current MVP still uses browser-forwarded bearer token and `DEV_WORKSPACE_ID` fallback, with `/api/workspaces/current` exposing current mode.

**Step 4: SETUP**

Add smoke step:

```md
Open `/dashboard` and confirm the Workspace card shows authenticated user/workspace after login, or explicit dev fallback mode when using `DEV_WORKSPACE_ID`.
```

**Step 5: BACKLOG**

Mark thin-slice items done if appropriate:

```md
- [x] Auth system
- [x] Workspace model
```

Add note:

```md
- Workspace/auth polish thin slice is implemented in `/dashboard` (current workspace card + sign out).
```

**Step 6: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/AUTH_FLOW.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document workspace auth polish"
```

---

## Task 6: Final verification

**Files:**
- No code changes expected unless fixing failures.

**Step 1: Run web lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 2: Run web build**

```bash
npm run build:web
```

Expected route output includes:

```text
/api/workspaces/current
```

**Step 3: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 4: Check worktree**

```bash
git status --short
```

Expected: clean except `.pi/` if present.

**Step 5: Commit final fixes if any**

If any fixes were needed:

```bash
git add <files>
git commit -m "chore: finalize workspace auth polish slice"
```

---

## Manual Smoke Test

With Supabase env configured:

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Open `/dashboard` without login but with `DEV_WORKSPACE_ID` configured.
3. Confirm Workspace card shows:
   ```text
   Mode: dev_fallback
   Workspace: Development Workspace
   ```
4. Log in through `/login`.
5. Return to `/dashboard`.
6. Confirm Workspace card shows:
   ```text
   Mode: authenticated
   Signed in as: <email>
   Workspace: <workspace name>
   Role: owner
   ```
7. Click `Log out`.
8. Confirm redirect to `/login`.
9. Return to dashboard and confirm session-dependent APIs fall back to dev mode only if `DEV_WORKSPACE_ID` is configured.

---

## Deferred Work

Do not implement these in this plan:

- Full SSR cookie auth.
- Next.js middleware route protection.
- Removing `DEV_WORKSPACE_ID`.
- Workspace switcher.
- Team invitations.
- Workspace settings CRUD.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-workspace-auth-polish-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-workspace-auth-polish-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
