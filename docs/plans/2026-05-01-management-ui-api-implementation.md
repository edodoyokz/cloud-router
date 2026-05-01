# Management UI/API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add provider/API-key management APIs and dashboard sections so users can list, disconnect, and revoke resources after creating them.

**Architecture:** Extend existing Next.js control-plane route handlers using the hybrid workspace resolver and Supabase admin REST helper. Update the dashboard client to load resource lists with the existing Supabase bearer-token pattern, refresh lists after mutations, and add router hardening so disconnected providers are not used.

**Tech Stack:** Next.js 16 App Router, React 19 client component, Supabase PostgREST via existing admin helper, Go router repository tests, npm workspace scripts.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-management-ui-api-design.md
```

Relevant files:

```text
apps/web/app/api/providers/route.js
apps/web/app/api/endpoint/keys/route.js
apps/web/app/dashboard/dashboard-client.jsx
apps/web/lib/workspace.js
apps/web/lib/supabase-admin.js
apps/web/lib/supabase-browser.js
services/router/internal/store/store.go
services/router/internal/store/memory.go
services/router/internal/store/supabase.go
services/router/internal/store/supabase_test.go
services/router/internal/httpserver/server_test.go
README.md
docs/API_CONTRACT.md
docs/SETUP.md
```

Current behavior:

- `POST /api/providers` creates a provider and appends it to default preset.
- `POST /api/endpoint/keys` creates an API key and returns raw key once.
- Dashboard sends bearer token when available.
- No provider/API-key list APIs are implemented.
- No provider/API-key management UI exists.
- Router API key lookup already rejects revoked keys via `revoked_at=is.null`.
- Router provider lookup should be hardened to use only active providers.

---

## Task 1: Add provider list API

**Files:**
- Modify: `apps/web/app/api/providers/route.js`

**Step 1: Add GET handler**

In `apps/web/app/api/providers/route.js`, add this exported handler above or below `POST`:

```js
export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const providers = await supabaseSelect(
      'provider_connections',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,display_name,auth_method,status,metadata,created_at&order=created_at.desc`
    );
    return NextResponse.json(providers);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 2: Verify route compiles**

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/web/app/api/providers/route.js
git commit -m "feat: list provider connections"
```

---

## Task 2: Add provider disconnect API

**Files:**
- Create: `apps/web/app/api/providers/[id]/route.js`

**Step 1: Create dynamic route**

Create `apps/web/app/api/providers/[id]/route.js`:

```js
import { NextResponse } from 'next/server';
import { supabasePatch } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function DELETE(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('provider id is required'), { status: 400, code: 'validation_error' });

    const rows = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { status: 'disconnected' }
    );
    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    return NextResponse.json({ disconnected: true });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

Note: In Next.js 16, dynamic `params` may be promise-like. `await params` is acceptable.

**Step 2: Verify route compiles**

Run:

```bash
npm run build:web
```

Expected route output includes:

```text
/api/providers/[id]
```

**Step 3: Commit**

```bash
git add apps/web/app/api/providers/[id]/route.js
git commit -m "feat: disconnect provider connections"
```

---

## Task 3: Add API key list API

**Files:**
- Modify: `apps/web/app/api/endpoint/keys/route.js`

**Step 1: Add GET handler**

In `apps/web/app/api/endpoint/keys/route.js`, add this exported handler above or below `POST`:

```js
export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const keys = await supabaseSelect(
      'api_keys',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,name,prefix,created_at,last_used_at,revoked_at&order=created_at.desc`
    );
    return NextResponse.json(keys);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 2: Ensure imports include `supabaseSelect`**

Current file likely has:

```js
import { supabaseInsert } from '../../../../lib/supabase-admin.js';
```

Change to:

```js
import { supabaseInsert, supabaseSelect } from '../../../../lib/supabase-admin.js';
```

**Step 3: Verify no secret fields are selected**

Run:

```bash
rg "key_hash|raw_key" apps/web/app/api/endpoint/keys/route.js
```

Expected:

- `raw_key` appears only in POST response.
- `key_hash` appears only for inserting hash, not GET select.

**Step 4: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/app/api/endpoint/keys/route.js
git commit -m "feat: list router api keys"
```

---

## Task 4: Add API key revoke API

**Files:**
- Create: `apps/web/app/api/endpoint/keys/[id]/route.js`

**Step 1: Create dynamic route**

Create `apps/web/app/api/endpoint/keys/[id]/route.js`:

```js
import { NextResponse } from 'next/server';
import { supabasePatch } from '../../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../../lib/workspace.js';

export async function DELETE(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('api key id is required'), { status: 400, code: 'validation_error' });

    const rows = await supabasePatch(
      'api_keys',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { revoked_at: new Date().toISOString() }
    );
    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('api key not found'), { status: 404, code: 'not_found' });
    }

    return NextResponse.json({ revoked: true });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 2: Verify route compiles**

Run:

```bash
npm run build:web
```

Expected route output includes:

```text
/api/endpoint/keys/[id]
```

**Step 3: Commit**

```bash
git add apps/web/app/api/endpoint/keys/[id]/route.js
git commit -m "feat: revoke router api keys"
```

---

## Task 5: Harden router provider status handling

**Files:**
- Modify: `services/router/internal/store/memory.go`
- Modify: `services/router/internal/store/supabase.go`
- Modify: `services/router/internal/store/supabase_test.go`
- Possibly modify: `services/router/internal/httpserver/server_test.go` if memory repo tests need explicit active status.

**Step 1: Inspect current memory repo behavior**

Read:

```bash
rg "ProviderConnection" services/router/internal/store services/router/internal/httpserver -n
```

Identify how providers are stored and returned.

**Step 2: Add/adjust test for Supabase active provider query**

In `services/router/internal/store/supabase_test.go`, update `TestSupabaseRepositoryProviderConnection` handler to assert query contains `status=eq.active`.

Example inside handler before writing response:

```go
if got := r.URL.Query().Get("status"); got != "eq.active" {
    t.Fatalf("expected active provider filter, got %q", got)
}
```

Run:

```bash
cd services/router && go test ./internal/store -run TestSupabaseRepositoryProviderConnection -v
```

Expected: FAIL before implementation.

**Step 3: Implement Supabase active provider filter**

In `services/router/internal/store/supabase.go`, update provider query from:

```go
query := "/rest/v1/provider_connections?id=eq." + url.QueryEscape(providerConnectionID) + "&workspace_id=eq." + url.QueryEscape(workspaceID) + "&select=*"
```

to:

```go
query := "/rest/v1/provider_connections?id=eq." + url.QueryEscape(providerConnectionID) + "&workspace_id=eq." + url.QueryEscape(workspaceID) + "&status=eq.active&select=*"
```

**Step 4: Harden memory repo**

In `services/router/internal/store/memory.go`, update `ProviderConnection` to return not found when provider status is non-empty and not `active`.

Expected logic:

```go
if provider.Status != "" && provider.Status != "active" {
    return ProviderConnection{}, false, nil
}
```

**Step 5: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

If any tests fail because test providers have empty status, either keep empty status as active-compatible as shown above or set test provider status to `active`.

**Step 6: Commit**

```bash
git add services/router/internal/store/memory.go services/router/internal/store/supabase.go services/router/internal/store/supabase_test.go services/router/internal/httpserver/server_test.go
git commit -m "fix: ignore disconnected providers in router"
```

If `server_test.go` was not modified, omit it from `git add`.

---

## Task 6: Add dashboard management API helpers and load lists

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add state**

Inside `DashboardClient`, add state:

```js
const [providers, setProviders] = useState([]);
const [apiKeys, setApiKeys] = useState([]);
const [managementStatus, setManagementStatus] = useState(null);
const [loadingResources, setLoadingResources] = useState(false);
const [pendingActionId, setPendingActionId] = useState(null);
```

**Step 2: Import `useEffect`**

Change React import from:

```js
import { useMemo, useState } from 'react';
```

to:

```js
import { useEffect, useMemo, useState } from 'react';
```

**Step 3: Add JSON response helper outside component**

Add near bottom/top of file:

```js
async function parseJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || fallbackMessage);
  return data;
}
```

**Step 4: Add `loadResources` inside component**

Inside `DashboardClient`, add:

```js
async function loadResources() {
  setLoadingResources(true);
  setManagementStatus(null);
  try {
    const headers = await authenticatedJsonHeaders();
    const [providerResponse, keyResponse] = await Promise.all([
      fetch('/api/providers', { headers }),
      fetch('/api/endpoint/keys', { headers })
    ]);
    const [providerData, keyData] = await Promise.all([
      parseJsonResponse(providerResponse, 'Failed to load providers'),
      parseJsonResponse(keyResponse, 'Failed to load API keys')
    ]);
    setProviders(providerData);
    setApiKeys(keyData);
  } catch (error) {
    setManagementStatus({ type: 'error', message: error.message || 'Failed to load dashboard resources' });
  } finally {
    setLoadingResources(false);
  }
}
```

**Step 5: Load on mount**

Add:

```js
useEffect(() => {
  loadResources();
}, []);
```

Note: If lint complains about missing dependency, wrap `loadResources` in `useCallback` or disable only if necessary. Preferred: use `useCallback` with stable deps if needed.

**Step 6: Refresh after creates**

After successful provider creation, add:

```js
await loadResources();
```

After successful key generation, add:

```js
await loadResources();
```

**Step 7: Run lint and fix hook dependency issues**

Run:

```bash
npm run lint:web
```

Expected: PASS. If React hook dependency lint complains, convert `loadResources` and `authenticatedJsonHeaders` to `useCallback` with appropriate dependencies.

**Step 8: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: load dashboard management resources"
```

---

## Task 7: Add provider and API key management UI/actions

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add action functions inside component**

Add:

```js
async function disconnectProvider(providerId) {
  setPendingActionId(`provider:${providerId}`);
  setManagementStatus(null);
  try {
    const response = await fetch(`/api/providers/${providerId}`, {
      method: 'DELETE',
      headers: await authenticatedJsonHeaders()
    });
    await parseJsonResponse(response, 'Failed to disconnect provider');
    setManagementStatus({ type: 'success', message: 'Provider disconnected.' });
    await loadResources();
  } catch (error) {
    setManagementStatus({ type: 'error', message: error.message || 'Failed to disconnect provider' });
  } finally {
    setPendingActionId(null);
  }
}

async function revokeApiKey(keyId) {
  setPendingActionId(`key:${keyId}`);
  setManagementStatus(null);
  try {
    const response = await fetch(`/api/endpoint/keys/${keyId}`, {
      method: 'DELETE',
      headers: await authenticatedJsonHeaders()
    });
    await parseJsonResponse(response, 'Failed to revoke API key');
    setManagementStatus({ type: 'success', message: 'API key revoked.' });
    await loadResources();
  } catch (error) {
    setManagementStatus({ type: 'error', message: error.message || 'Failed to revoke API key' });
  } finally {
    setPendingActionId(null);
  }
}
```

**Step 2: Add date formatter outside component**

```js
function formatDate(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}
```

**Step 3: Add providers section to JSX**

Add a new section after the auth note and before create provider form:

```jsx
<section style={cardStyle}>
  <div>
    <h2 style={{ margin: 0 }}>Connected providers</h2>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Providers available to your default routing preset.</p>
  </div>
  {loadingResources ? <p>Loading providers…</p> : null}
  {providers.length === 0 && !loadingResources ? <p style={{ color: '#4b5563' }}>No providers yet.</p> : null}
  <div style={{ display: 'grid', gap: 12 }}>
    {providers.map((provider) => (
      <div key={provider.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
        <strong>{provider.display_name}</strong>
        <span>Status: {provider.status}</span>
        <span>Type: {provider.provider_type}</span>
        <span>Base URL: {provider.metadata?.base_url || '—'}</span>
        <span>Default model: {provider.metadata?.default_model || '—'}</span>
        <span>Created: {formatDate(provider.created_at)}</span>
        {provider.status !== 'disconnected' ? (
          <button style={buttonStyle} disabled={pendingActionId === `provider:${provider.id}`} onClick={() => disconnectProvider(provider.id)} type="button">
            {pendingActionId === `provider:${provider.id}` ? 'Disconnecting…' : 'Disconnect provider'}
          </button>
        ) : null}
      </div>
    ))}
  </div>
</section>
```

**Step 4: Add API keys section to JSX**

Add a section near the generate key section:

```jsx
<section style={cardStyle}>
  <div>
    <h2 style={{ margin: 0 }}>Router API keys</h2>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Raw keys are shown only once when generated.</p>
  </div>
  {loadingResources ? <p>Loading API keys…</p> : null}
  {apiKeys.length === 0 && !loadingResources ? <p style={{ color: '#4b5563' }}>No API keys yet.</p> : null}
  <div style={{ display: 'grid', gap: 12 }}>
    {apiKeys.map((key) => (
      <div key={key.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
        <strong>{key.name}</strong>
        <span>Prefix: <code>{key.prefix}</code></span>
        <span>Created: {formatDate(key.created_at)}</span>
        <span>Last used: {formatDate(key.last_used_at)}</span>
        <span>Status: {key.revoked_at ? `revoked at ${formatDate(key.revoked_at)}` : 'active'}</span>
        {!key.revoked_at ? (
          <button style={buttonStyle} disabled={pendingActionId === `key:${key.id}`} onClick={() => revokeApiKey(key.id)} type="button">
            {pendingActionId === `key:${key.id}` ? 'Revoking…' : 'Revoke key'}
          </button>
        ) : null}
      </div>
    ))}
  </div>
</section>
```

**Step 5: Render management status**

Near top of component output after auth note:

```jsx
{managementStatus ? <StatusMessage status={managementStatus} /> : null}
```

**Step 6: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: manage providers and api keys in dashboard"
```

---

## Task 8: Update docs/API contract

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: Update README current thin slice**

Add bullet:

```md
- Dashboard lists providers/API keys and supports disconnect/revoke actions
```

Update next build steps:

```md
## Next Build Steps
1. Add usage dashboard
2. Add provider health checks
3. Add preset editor UI
4. Add production cookie/SSR auth polish and workspace switching
```

**Step 2: Update API contract auth note if needed**

Current contract may mention cookie-only auth. Update to note current thin slice accepts bearer token:

```md
Current thin slice accepts `Authorization: Bearer <supabase_access_token>` from the browser. Production cookie/SSR auth polish is deferred.
```

Ensure these endpoints are documented:

```text
GET /api/providers
DELETE /api/providers/:id
GET /api/endpoint/keys
DELETE /api/endpoint/keys/:id
```

**Step 3: Update setup docs**

Add a short management smoke test:

```md
After logging in and opening `/dashboard`, create a provider/key, confirm they appear in the lists, then test disconnect/revoke.
```

**Step 4: Update backlog**

Mark or note provider/API key management is now present as a thin slice. Do not over-edit backlog unless existing style supports checkboxes.

**Step 5: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document management ui api flow"
```

---

## Task 9: Final verification

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
/api/providers/[id]
/api/endpoint/keys/[id]
/dashboard
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
git commit -m "chore: finalize management ui api slice"
```

---

## Manual Smoke Test With Supabase

With Supabase env configured and schema applied:

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Log in at:
   ```text
   http://localhost:3000/login
   ```
3. Open:
   ```text
   http://localhost:3000/dashboard
   ```
4. Create a provider.
5. Confirm provider appears in Connected providers.
6. Disconnect provider.
7. Confirm provider status becomes `disconnected`.
8. Generate router API key.
9. Confirm API key appears in Router API keys list without raw key/hash.
10. Revoke API key.
11. Confirm key status becomes revoked.

---

## Deferred Work

Do not implement these in this plan:

- Provider edit/reconnect.
- API key rename.
- API key hard delete.
- Provider hard delete.
- Usage dashboard.
- Provider health check.
- Preset editor.
- Workspace switcher.
- Production cookie/SSR auth polish.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-management-ui-api-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-management-ui-api-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
