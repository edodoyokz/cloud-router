# Hybrid Auth Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add thin Supabase Auth login/signup and hybrid workspace auto-resolution so control-plane API routes use authenticated user sessions before falling back to `DEV_WORKSPACE_ID`.

**Architecture:** Browser auth uses `@supabase/supabase-js` and forwards the Supabase access token to Next.js API routes as a bearer token. Server helpers verify bearer tokens through Supabase Auth REST, map Supabase users into the existing internal `users/workspaces/workspace_members` schema, and auto-create a personal workspace when needed.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Supabase Auth REST, `@supabase/supabase-js`, existing Supabase PostgREST admin helper, existing npm workspace scripts.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-auth-workspace-hybrid-design.md
```

Existing relevant files:

```text
apps/web/app/dashboard/dashboard-client.jsx
apps/web/app/dashboard/page.jsx
apps/web/app/api/providers/route.js
apps/web/app/api/endpoint/keys/route.js
apps/web/lib/workspace.js
apps/web/lib/supabase-admin.js
apps/web/package.json
package.json
docs/schema.sql
docs/AUTH_FLOW.md
docs/ENV_CONFIG.md
docs/SETUP.md
```

Current behavior:

- `resolveWorkspaceId()` only uses `DEV_WORKSPACE_ID`.
- API routes call `resolveWorkspaceId()` synchronously.
- Dashboard API calls do not send Supabase bearer tokens.
- `apps/web` does not yet depend on `@supabase/supabase-js`.

Schema already contains:

```text
users
workspaces
workspace_members
```

Supabase Auth mapping must be:

```text
auth.users.id -> users.auth_provider_id
auth.users.email -> users.email
users.auth_provider = 'supabase'
```

---

## Task 1: Add Supabase browser dependency and client helper

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Create: `apps/web/lib/supabase-browser.js`

**Step 1: Install dependency**

Run:

```bash
npm install --workspace apps/web @supabase/supabase-js
```

Expected:

- `apps/web/package.json` includes `@supabase/supabase-js`.
- `package-lock.json` updates.

**Step 2: Create browser client helper**

Create `apps/web/lib/supabase-browser.js`:

```js
import { createClient } from '@supabase/supabase-js';

let browserClient;

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');
  if (!browserClient) {
    browserClient = createClient(url, anonKey);
  }
  return browserClient;
}
```

**Step 3: Verify install/build**

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/lib/supabase-browser.js
git commit -m "feat: add supabase browser client"
```

---

## Task 2: Add server auth helper

**Files:**
- Create: `apps/web/lib/auth.js`

**Step 1: Create helper**

Create `apps/web/lib/auth.js`:

```js
export function bearerTokenFromRequest(request) {
  const header = request?.headers?.get?.('authorization') || request?.headers?.get?.('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function getSupabaseAuthConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw Object.assign(new Error('NEXT_PUBLIC_SUPABASE_URL is required'), { status: 500, code: 'configuration_error' });
  if (!anonKey) throw Object.assign(new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required'), { status: 500, code: 'configuration_error' });
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export async function getAuthenticatedUser(request) {
  const token = bearerTokenFromRequest(request);
  if (!token) return null;

  const { url, anonKey } = getSupabaseAuthConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    },
    cache: 'no-store'
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw Object.assign(new Error(data?.msg || data?.message || 'Supabase session is invalid'), {
      status: 401,
      code: 'invalid_session'
    });
  }

  if (!data?.id || !data?.email) {
    throw Object.assign(new Error('Supabase session is missing user identity'), {
      status: 401,
      code: 'invalid_session'
    });
  }

  return { id: data.id, email: data.email };
}
```

**Step 2: Verify helper imports**

Run:

```bash
node -e "import('./apps/web/lib/auth.js').then(m => console.log(Boolean(m.bearerTokenFromRequest)))"
```

Expected output:

```text
true
```

Note: Node may print a module-type warning. That is acceptable if build/lint pass.

**Step 3: Commit**

```bash
git add apps/web/lib/auth.js
git commit -m "feat: add server auth helper"
```

---

## Task 3: Implement hybrid workspace resolver

**Files:**
- Modify: `apps/web/lib/workspace.js`

**Step 1: Replace workspace resolver**

Replace `apps/web/lib/workspace.js` with:

```js
import { randomBytes } from 'crypto';
import { getAuthenticatedUser } from './auth.js';
import { supabaseInsert, supabaseSelect } from './supabase-admin.js';

export async function resolveWorkspaceId(request) {
  const authUser = await getAuthenticatedUser(request);
  if (authUser) {
    const appUser = await ensureInternalUser(authUser);
    const workspace = await ensurePersonalWorkspace(appUser, authUser.email);
    return workspace.id;
  }

  const workspaceId = process.env.DEV_WORKSPACE_ID;
  if (!workspaceId) {
    const error = new Error('workspace could not be resolved');
    error.code = 'workspace_not_resolved';
    error.status = 401;
    throw error;
  }
  return workspaceId;
}

export async function requireAuthenticatedWorkspaceId(request) {
  const authUser = await getAuthenticatedUser(request);
  if (!authUser) {
    throw Object.assign(new Error('authentication is required'), { status: 401, code: 'authentication_required' });
  }
  const appUser = await ensureInternalUser(authUser);
  const workspace = await ensurePersonalWorkspace(appUser, authUser.email);
  return workspace.id;
}

export async function ensureInternalUser(authUser) {
  const query = `?auth_provider=eq.supabase&auth_provider_id=eq.${encodeURIComponent(authUser.id)}&select=*`;
  const existing = await supabaseSelect('users', query);
  if (existing.length > 0) return existing[0];

  const [created] = await supabaseInsert('users', [{
    email: authUser.email,
    auth_provider: 'supabase',
    auth_provider_id: authUser.id
  }]);
  return created;
}

export async function ensurePersonalWorkspace(appUser, email) {
  const membershipQuery = `?user_id=eq.${encodeURIComponent(appUser.id)}&select=workspace_id,role&limit=1`;
  const memberships = await supabaseSelect('workspace_members', membershipQuery);
  if (memberships.length > 0) {
    return { id: memberships[0].workspace_id };
  }

  const [workspace] = await supabaseInsert('workspaces', [{
    owner_user_id: appUser.id,
    name: personalWorkspaceName(email),
    slug: personalWorkspaceSlug(email)
  }]);

  await supabaseInsert('workspace_members', [{
    workspace_id: workspace.id,
    user_id: appUser.id,
    role: 'owner'
  }]);

  return workspace;
}

export function personalWorkspaceName(email) {
  const prefix = String(email || 'User').split('@')[0] || 'User';
  return `${prefix}'s Workspace`;
}

export function personalWorkspaceSlug(email) {
  const prefix = String(email || 'workspace')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  return `${prefix}-${randomBytes(3).toString('hex')}`;
}
```

**Step 2: Verify pure slug/name helpers**

Run:

```bash
node -e "import('./apps/web/lib/workspace.js').then(m => { console.log(m.personalWorkspaceName('ada@example.com')); console.log(/^ada-[a-f0-9]{6}$/.test(m.personalWorkspaceSlug('ada@example.com'))); })"
```

Expected output includes:

```text
ada's Workspace
true
```

**Step 3: Commit**

```bash
git add apps/web/lib/workspace.js
git commit -m "feat: add hybrid workspace resolver"
```

---

## Task 4: Add auth bootstrap API route

**Files:**
- Create: `apps/web/app/api/auth/bootstrap/route.js`

**Step 1: Create route directory and file**

Create `apps/web/app/api/auth/bootstrap/route.js`:

```js
import { NextResponse } from 'next/server';
import { requireAuthenticatedWorkspaceId } from '../../../../lib/workspace.js';

export async function POST(request) {
  try {
    const workspaceId = await requireAuthenticatedWorkspaceId(request);
    return NextResponse.json({ workspace_id: workspaceId, status: 'ready' });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'auth_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 2: Build to verify route compiles**

Run:

```bash
npm run build:web
```

Expected route output includes:

```text
/api/auth/bootstrap
```

**Step 3: Commit**

```bash
git add apps/web/app/api/auth/bootstrap/route.js
git commit -m "feat: add auth bootstrap route"
```

---

## Task 5: Update provider/key API routes to await workspace resolution

**Files:**
- Modify: `apps/web/app/api/providers/route.js`
- Modify: `apps/web/app/api/endpoint/keys/route.js`

**Step 1: Update provider route**

In `apps/web/app/api/providers/route.js`, change:

```js
const workspaceId = resolveWorkspaceId();
```

to:

```js
const workspaceId = await resolveWorkspaceId(request);
```

**Step 2: Update endpoint key route**

In `apps/web/app/api/endpoint/keys/route.js`, change:

```js
const workspaceId = resolveWorkspaceId();
```

to:

```js
const workspaceId = await resolveWorkspaceId(request);
```

**Step 3: Verify no stale sync calls**

Run:

```bash
rg "resolveWorkspaceId\(" apps/web/app apps/web/lib
```

Expected route calls pass `request` or are function definitions/imports only.

**Step 4: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/app/api/providers/route.js apps/web/app/api/endpoint/keys/route.js
git commit -m "feat: resolve workspace from auth session in api routes"
```

---

## Task 6: Add shared auth form client component

**Files:**
- Create: `apps/web/app/auth-form.jsx`

**Step 1: Create auth form**

Create `apps/web/app/auth-form.jsx`:

```jsx
'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabase-browser.js';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d0d7de',
  fontSize: 14,
  boxSizing: 'border-box'
};

const buttonStyle = {
  border: 0,
  borderRadius: 10,
  padding: '11px 14px',
  background: '#111827',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer'
};

export default function AuthForm({ mode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);
  const isSignup = mode === 'signup';

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setStatus(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = isSignup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      const session = result.data?.session;
      if (!session?.access_token) {
        setStatus({ type: 'success', message: 'Check your email to confirm your account, then log in.' });
        return;
      }

      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Failed to prepare workspace');

      setStatus({ type: 'success', message: 'Workspace ready. You can open the dashboard now.' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Authentication failed' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        Email
        <input style={inputStyle} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        Password
        <input style={inputStyle} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
      </label>
      <button style={buttonStyle} type="submit" disabled={pending}>{pending ? 'Working…' : isSignup ? 'Create account' : 'Log in'}</button>
      {status ? <StatusMessage status={status} /> : null}
      {status?.type === 'success' ? <a href="/dashboard">Open dashboard</a> : null}
    </form>
  );
}

function StatusMessage({ status }) {
  const isError = status.type === 'error';
  return (
    <div style={{
      borderRadius: 10,
      padding: '10px 12px',
      background: isError ? '#fef2f2' : '#ecfdf5',
      color: isError ? '#991b1b' : '#065f46',
      border: `1px solid ${isError ? '#fecaca' : '#a7f3d0'}`
    }}>
      {status.message}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/app/auth-form.jsx
git commit -m "feat: add auth form component"
```

---

## Task 7: Add login/signup pages

**Files:**
- Create: `apps/web/app/login/page.jsx`
- Create: `apps/web/app/signup/page.jsx`

**Step 1: Create login page**

Create `apps/web/app/login/page.jsx`:

```jsx
import AuthForm from '../auth-form.jsx';

export const metadata = {
  title: 'Login — NusaNexus Router'
};

export default function LoginPage() {
  return <AuthPage title="Log in" subtitle="Access your NusaNexus Router dashboard." mode="login" alternateHref="/signup" alternateText="Need an account? Sign up" />;
}

function AuthPage({ title, subtitle, mode, alternateHref, alternateText }) {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 24px', display: 'grid', gap: 20 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <a href="/">NusaNexus Router</a>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <p style={{ margin: 0, color: '#4b5563' }}>{subtitle}</p>
        </header>
        <section style={{ border: '1px solid #d0d7de', borderRadius: 16, padding: 20, background: '#fff' }}>
          <AuthForm mode={mode} />
        </section>
        <a href={alternateHref}>{alternateText}</a>
      </div>
    </main>
  );
}
```

**Step 2: Create signup page**

Create `apps/web/app/signup/page.jsx`:

```jsx
import AuthForm from '../auth-form.jsx';

export const metadata = {
  title: 'Sign up — NusaNexus Router'
};

export default function SignupPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 24px', display: 'grid', gap: 20 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <a href="/">NusaNexus Router</a>
          <h1 style={{ margin: 0 }}>Create account</h1>
          <p style={{ margin: 0, color: '#4b5563' }}>Create your account and personal workspace.</p>
        </header>
        <section style={{ border: '1px solid #d0d7de', borderRadius: 16, padding: 20, background: '#fff' }}>
          <AuthForm mode="signup" />
        </section>
        <a href="/login">Already have an account? Log in</a>
      </div>
    </main>
  );
}
```

**Step 3: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected route output includes:

```text
/login
/signup
```

**Step 4: Commit**

```bash
git add apps/web/app/login/page.jsx apps/web/app/signup/page.jsx
git commit -m "feat: add login and signup pages"
```

---

## Task 8: Send bearer token from dashboard API calls

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Import browser client**

Add import:

```js
import { getSupabaseBrowserClient } from '../../lib/supabase-browser.js';
```

**Step 2: Add API headers helper inside component file**

Add before `connectProvider`:

```js
async function authenticatedJsonHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // Missing client env should not break DEV_WORKSPACE_ID fallback.
  }
  return headers;
}
```

**Step 3: Use helper for API calls**

In provider fetch, replace headers with:

```js
headers: await authenticatedJsonHeaders(),
```

In key fetch, replace headers with:

```js
headers: await authenticatedJsonHeaders(),
```

**Step 4: Add auth links/note**

Near the top of returned JSX, add a small section:

```jsx
<section style={cardStyle}>
  <strong>Authenticated mode</strong>
  <p style={{ margin: 0, color: '#4b5563' }}>Log in to resolve workspace from your Supabase session. Local dev can still use DEV_WORKSPACE_ID.</p>
  <div style={{ display: 'flex', gap: 12 }}>
    <a href="/login">Log in</a>
    <a href="/signup">Sign up</a>
  </div>
</section>
```

**Step 5: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: send auth bearer from dashboard"
```

---

## Task 9: Update landing page links

**Files:**
- Modify: `apps/web/app/page.jsx`

**Step 1: Add login/signup links**

Update page to include links to dashboard, login, and signup. Minimal acceptable version:

```jsx
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1>NusaNexus Router</h1>
      <p>Hosted AI router untuk coding tools, zero-setup.</p>
      <nav style={{ display: 'flex', gap: 12 }}>
        <a href="/dashboard">Open dashboard</a>
        <a href="/login">Log in</a>
        <a href="/signup">Sign up</a>
      </nav>
    </main>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/app/page.jsx
git commit -m "feat: link auth pages from landing"
```

---

## Task 10: Update docs and env config

**Files:**
- Modify: `README.md`
- Modify: `docs/AUTH_FLOW.md`
- Modify: `docs/ENV_CONFIG.md`
- Modify: `docs/SETUP.md`

**Step 1: Update README current thin slice**

Add bullet:

```md
- Thin Supabase Auth login/signup with hybrid workspace auto-create
```

Update next build steps to move auth out of first position:

```md
## Next Build Steps
1. Add provider/API key listing and revoke/disconnect flows
2. Add usage dashboard
3. Add provider health checks
4. Add production cookie/SSR auth polish and workspace switching
```

**Step 2: Update AUTH_FLOW**

Add a note under User Auth that MVP API routes accept bearer tokens from the browser and map Supabase users into internal `users/workspaces/workspace_members` rows.

**Step 3: Update ENV_CONFIG**

Ensure these are documented:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=
DEV_WORKSPACE_ID= # optional local fallback
```

**Step 4: Update SETUP**

Add:

```md
Open `/signup` to create an account, then `/login` and `/dashboard`.
For local development without auth, `DEV_WORKSPACE_ID` can still be used as a fallback.
```

**Step 5: Commit**

```bash
git add README.md docs/AUTH_FLOW.md docs/ENV_CONFIG.md docs/SETUP.md
git commit -m "docs: document hybrid auth workspace flow"
```

---

## Task 11: Final verification

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
/api/auth/bootstrap
/login
/signup
/dashboard
```

**Step 3: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 4: Check status**

```bash
git status --short
```

Expected: clean except `.pi/` if present.

**Step 5: Commit final fixes if any**

If any verification fixes are needed:

```bash
git add <files>
git commit -m "chore: finalize hybrid auth workspace slice"
```

---

## Manual Smoke Test After Deployment/Local Env

With Supabase env configured and `docs/schema.sql` applied:

1. Run web app:
   ```bash
   npm run dev:web
   ```
2. Open:
   ```text
   http://localhost:3000/signup
   ```
3. Create account.
4. If email confirmation is enabled, confirm email and log in.
5. Open:
   ```text
   http://localhost:3000/dashboard
   ```
6. Connect provider.
7. Generate router API key.
8. Confirm Supabase tables contain:
   - `users`
   - `workspaces`
   - `workspace_members`
   - `provider_connections`
   - `api_keys`

---

## Deferred Work

Do not implement these in this plan:

- Full SSR/cookie auth.
- Password reset.
- OAuth providers.
- Workspace switcher.
- Team invitations.
- RLS policy design.
- Provider/API key management lists.
- Usage dashboard.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-auth-workspace-hybrid-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-auth-workspace-hybrid-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
