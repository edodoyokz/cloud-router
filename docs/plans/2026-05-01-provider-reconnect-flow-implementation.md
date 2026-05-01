# Provider Reconnect Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add provider reconnect / credential rotation flow for existing OpenAI-compatible API-key providers.

**Architecture:** Add `PATCH /api/providers/[id]` to validate reconnect input, encrypt the new provider API key, patch the workspace-scoped provider in Supabase, and return safe fields. Extend the dashboard provider cards with an inline reconnect form. No Go router changes are expected.

**Tech Stack:** Next.js 16 App Router, React 19 dashboard client, Supabase PostgREST admin helper, existing crypto/provider validation helpers.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-provider-reconnect-flow-design.md
```

Relevant files:

```text
apps/web/app/api/providers/[id]/route.js
apps/web/app/api/providers/route.js
apps/web/lib/provider-validation.js
apps/web/lib/crypto.js
apps/web/lib/supabase-admin.js
apps/web/app/dashboard/dashboard-client.jsx
README.md
docs/API_CONTRACT.md
docs/SETUP.md
docs/BACKLOG.md
```

Current behavior:

- `DELETE /api/providers/[id]` soft-disconnects a provider.
- `POST /api/providers/[id]/check` rejects disconnected providers.
- `GET /api/providers` returns safe provider metadata but no credentials.
- Provider creation validates OpenAI-compatible API-key inputs and encrypts credentials.
- Dashboard provider card supports health check and disconnect, but not reconnect.

Constraints:

- Never return credential material.
- New API key is required for reconnect.
- Reconnect updates existing provider in-place; it must not create a duplicate provider.
- Health check remains manual after reconnect.
- No router changes expected.

---

## Task 1: Add provider reconnect PATCH API

**Files:**
- Modify: `apps/web/app/api/providers/[id]/route.js`

**Step 1: Update imports**

Current imports:

```js
import { NextResponse } from 'next/server';
import { supabasePatch } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';
```

Change to:

```js
import { NextResponse } from 'next/server';
import { encryptCredential } from '../../../../lib/crypto.js';
import { normalizeProviderInput } from '../../../../lib/provider-validation.js';
import { supabasePatch, supabaseSelect } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';
```

**Step 2: Add `PATCH` handler**

Add above or below `DELETE`:

```js
export async function PATCH(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('provider id is required'), { status: 400, code: 'validation_error' });

    const existing = await supabaseSelect(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,auth_method,created_at&limit=1`
    );
    if (existing.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }
    const provider = existing[0];
    if (provider.provider_type !== 'openai_compatible' || provider.auth_method !== 'api_key') {
      throw Object.assign(new Error('Only OpenAI-compatible API-key providers can be reconnected'), { status: 400, code: 'validation_error' });
    }

    const body = await request.json();
    const input = normalizeProviderInput({
      provider_type: provider.provider_type,
      auth_method: provider.auth_method,
      ...body
    });

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw Object.assign(new Error('ENCRYPTION_KEY is required'), { status: 500, code: 'configuration_error' });
    }

    const credential_encrypted = encryptCredential(encryptionKey, JSON.stringify({ api_key: input.api_key }));
    const rows = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      {
        display_name: input.display_name,
        metadata: { base_url: input.base_url, default_model: input.default_model },
        credential_encrypted,
        status: 'active',
        quota_state: {},
        last_checked_at: null
      }
    );

    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    const updated = rows[0];
    return NextResponse.json({
      id: updated.id,
      provider_type: updated.provider_type,
      display_name: updated.display_name,
      auth_method: updated.auth_method,
      status: updated.status,
      metadata: updated.metadata,
      quota_state: updated.quota_state,
      last_checked_at: updated.last_checked_at,
      created_at: updated.created_at
    });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 3: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

Build route should still include:

```text
/api/providers/[id]
```

**Step 4: Commit**

```bash
git add apps/web/app/api/providers/[id]/route.js
git commit -m "feat: add provider reconnect api"
```

---

## Task 2: Add dashboard reconnect state and handlers

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add state**

Inside `DashboardClient`, near provider-related state declarations, add:

```js
const [reconnectProviderId, setReconnectProviderId] = useState(null);
const [reconnectForm, setReconnectForm] = useState({
  display_name: '',
  base_url: '',
  default_model: '',
  api_key: ''
});
```

**Step 2: Add helper functions**

Inside component, near other provider actions, add:

```js
function startReconnect(provider) {
  setReconnectProviderId(provider.id);
  setReconnectForm({
    display_name: provider.display_name || '',
    base_url: provider.metadata?.base_url || '',
    default_model: provider.metadata?.default_model || '',
    api_key: ''
  });
  setManagementStatus(null);
}

function cancelReconnect() {
  setReconnectProviderId(null);
  setReconnectForm({ display_name: '', base_url: '', default_model: '', api_key: '' });
}

function updateReconnectField(field, value) {
  setReconnectForm((current) => ({ ...current, [field]: value }));
}
```

**Step 3: Add submit handler**

Inside component, near `disconnectProvider` / `checkProviderHealth`, add:

```js
async function reconnectProvider(providerId) {
  setPendingActionId(`provider-reconnect:${providerId}`);
  setManagementStatus(null);
  try {
    const response = await fetch(`/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: await authenticatedJsonHeaders(),
      body: JSON.stringify(reconnectForm)
    });
    await parseJsonResponse(response, 'Failed to reconnect provider');
    setManagementStatus({ type: 'success', message: 'Provider reconnected. Run health check to verify.' });
    cancelReconnect();
    await loadResources();
    await loadPreset();
  } catch (error) {
    setManagementStatus({ type: 'error', message: error.message || 'Failed to reconnect provider' });
  } finally {
    setPendingActionId(null);
  }
}
```

Calling `loadPreset()` is useful because reconnecting a disconnected provider can make an existing fallback-chain step valid/active again.

**Step 4: Lint check**

Run:

```bash
npm run lint:web
```

If lint reports unused functions/state, continue Task 3 before committing or combine Task 2+3 in one commit.

**Step 5: Commit if lint passes**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: add dashboard reconnect state"
```

If unused lint blocks, skip this commit and commit after Task 3.

---

## Task 3: Render inline reconnect form

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add reconnect button**

In provider card action buttons, current block includes health check and disconnect for non-disconnected providers:

```jsx
{provider.status !== 'disconnected' ? (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <button ...>Check health</button>
    <button ...>Disconnect provider</button>
  </div>
) : null}
```

Replace with an action block that always allows reconnect/rotate:

```jsx
<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
  {provider.status !== 'disconnected' ? (
    <>
      <button style={buttonStyle} disabled={pendingActionId === `provider-check:${provider.id}`} onClick={() => checkProviderHealth(provider.id)} type="button">
        {pendingActionId === `provider-check:${provider.id}` ? 'Checking…' : 'Check health'}
      </button>
      <button style={buttonStyle} disabled={pendingActionId === `provider:${provider.id}`} onClick={() => disconnectProvider(provider.id)} type="button">
        {pendingActionId === `provider:${provider.id}` ? 'Disconnecting…' : 'Disconnect provider'}
      </button>
    </>
  ) : null}
  <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={() => startReconnect(provider)}>
    Reconnect / rotate key
  </button>
</div>
```

**Step 2: Render form under provider actions**

Still inside each provider card, below the action block, add:

```jsx
{reconnectProviderId === provider.id ? (
  <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
    <strong>Reconnect provider</strong>
    <label style={labelStyle}>
      Provider name
      <input
        style={inputStyle}
        value={reconnectForm.display_name}
        onChange={(event) => updateReconnectField('display_name', event.target.value)}
      />
    </label>
    <label style={labelStyle}>
      Base URL
      <input
        style={inputStyle}
        value={reconnectForm.base_url}
        onChange={(event) => updateReconnectField('base_url', event.target.value)}
        placeholder="https://api.example.com"
      />
    </label>
    <label style={labelStyle}>
      Default model
      <input
        style={inputStyle}
        value={reconnectForm.default_model}
        onChange={(event) => updateReconnectField('default_model', event.target.value)}
        placeholder="gpt-4o-mini"
      />
    </label>
    <label style={labelStyle}>
      New provider API key
      <input
        style={inputStyle}
        type="password"
        value={reconnectForm.api_key}
        onChange={(event) => updateReconnectField('api_key', event.target.value)}
        placeholder="sk-..."
      />
    </label>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button
        style={buttonStyle}
        type="button"
        onClick={() => reconnectProvider(provider.id)}
        disabled={pendingActionId === `provider-reconnect:${provider.id}`}
      >
        {pendingActionId === `provider-reconnect:${provider.id}` ? 'Saving…' : 'Save reconnect'}
      </button>
      <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={cancelReconnect}>
        Cancel
      </button>
    </div>
  </div>
) : null}
```

**Step 3: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 4: Commit**

If Task 2 was committed separately:

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: add provider reconnect form"
```

If Task 2 was not committed due unused state/functions:

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: add provider reconnect form"
```

---

## Task 4: Update docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: README**

Add current thin slice bullet:

```md
- Dashboard can reconnect providers and rotate provider API keys
```

Update Next Build Steps:

```md
## Next Build Steps
1. Add pricing/cost estimation configuration
2. Add richer onboarding snippets for Claude Code / Codex / OpenClaw / Cursor
3. Add production SSR/cookie auth hardening
4. Add usage charts and provider breakdowns
```

**Step 2: API contract**

Add section near provider routes:

```md
### `PATCH /api/providers/{id}`
Reconnects or rotates an existing OpenAI-compatible API-key provider.

**Request**
```json
{
  "display_name": "OpenAI production",
  "base_url": "https://api.openai.com",
  "default_model": "gpt-4o-mini",
  "api_key": "sk-new"
}
```

**Response `200`**
```json
{
  "id": "uuid",
  "provider_type": "openai_compatible",
  "display_name": "OpenAI production",
  "auth_method": "api_key",
  "status": "active",
  "metadata": {
    "base_url": "https://api.openai.com",
    "default_model": "gpt-4o-mini"
  },
  "quota_state": {},
  "last_checked_at": null,
  "created_at": "2026-05-01T00:00:00.000Z"
}
```

The response never includes `credential_encrypted` or raw credential material. Health check remains manual after reconnect.
```

**Step 3: SETUP**

Add smoke step:

```md
Use a provider card's `Reconnect / rotate key` form to submit a new provider API key/base URL/default model, then run `Check health` manually to verify the provider.
```

**Step 4: BACKLOG**

Mark reconnect flow done:

```md
- [x] Reconnect flow
```

Add note:

```md
- Provider reconnect/credential rotation thin slice is implemented in `/dashboard`.
```

**Step 5: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document provider reconnect flow"
```

---

## Task 5: Final verification

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

Expected: PASS.

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
git commit -m "chore: finalize provider reconnect slice"
```

---

## Manual Smoke Test

With Supabase env configured:

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Log in and open `/dashboard`.
3. Connect a provider if needed.
4. Disconnect the provider.
5. Confirm health check button is hidden for the disconnected provider.
6. Click `Reconnect / rotate key`.
7. Submit:
   - provider name
   - base URL
   - default model
   - new provider API key
8. Confirm success message:
   ```text
   Provider reconnected. Run health check to verify.
   ```
9. Confirm provider status is `active`.
10. Click `Check health` manually.
11. Confirm health updates.
12. Confirm default fallback chain still references same provider ID.

---

## Deferred Work

Do not implement these in this plan:

- Auto health check after reconnect.
- Credential reuse without new API key.
- Provider OAuth reconnect.
- Provider secret version history.
- Full provider settings page.
- Bulk reconnect.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-provider-reconnect-flow-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-provider-reconnect-flow-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
