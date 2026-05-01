# Provider Health Checks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add manual provider health checks using a real non-streaming OpenAI-compatible chat completion probe, then show health status in the dashboard.

**Architecture:** Add server-side crypto decrypt support, provider health helper functions, a workspace-scoped `POST /api/providers/[id]/check` route, and dashboard controls/status rendering. The health route decrypts provider credentials server-side, runs a tiny `/v1/chat/completions` probe, patches provider status/health fields in Supabase, and returns a sanitized result.

**Tech Stack:** Next.js 16 App Router, Web Crypto API in Node runtime, React 19 dashboard client, Supabase PostgREST admin helper, existing hybrid workspace resolver, existing Go router tests.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-provider-health-checks-design.md
```

Relevant files:

```text
apps/web/lib/crypto.js
apps/web/lib/supabase-admin.js
apps/web/app/api/providers/route.js
apps/web/app/api/providers/[id]/route.js
apps/web/app/dashboard/dashboard-client.jsx
README.md
docs/API_CONTRACT.md
docs/SETUP.md
docs/BACKLOG.md
services/router/internal/store/supabase.go
services/router/internal/store/memory.go
```

Current behavior:

- Provider credentials are encrypted on creation.
- Provider rows include `status`, `quota_state`, and `last_checked_at`.
- Dashboard lists providers and can disconnect them.
- Router ignores non-active providers.
- No provider health check API exists yet.

Constraints:

- Real probe must use non-streaming chat completions with `max_tokens: 1`.
- Do not expose encrypted/decrypted credentials.
- Do not return full provider error bodies.
- Do not add DB migrations.
- Keep errors sanitized.

---

## Task 1: Add credential decrypt helper

**Files:**
- Modify: `apps/web/lib/crypto.js`

**Step 1: Inspect current crypto helper**

Read:

```bash
sed -n '1,240p' apps/web/lib/crypto.js
```

Expected current helper includes `encryptCredential` using AES-256-GCM format:

```text
base64(iv || ciphertext || tag)
```

Use existing key derivation/import pattern if present.

**Step 2: Add `decryptCredential` export**

Add a function matching the existing encryption format:

```js
export async function decryptCredential(encrypted) {
  if (!encrypted) throw new Error('missing encrypted credential');
  const key = await credentialKey();
  const payload = Buffer.from(encrypted, 'base64');
  if (payload.length <= 28) throw new Error('invalid encrypted credential');

  const iv = payload.subarray(0, 12);
  const cipherAndTag = payload.subarray(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherAndTag
  );

  return Buffer.from(decrypted).toString('utf8');
}
```

Adjust names to match current helper internals. Do not duplicate key logic if an internal key helper already exists.

**Step 3: Verify round-trip manually**

Run with a temporary local key:

```bash
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef node -e "import('./apps/web/lib/crypto.js').then(async m => { const enc = await m.encryptCredential('sk-test'); const dec = await m.decryptCredential(enc); console.log(dec); })"
```

Expected:

```text
sk-test
```

Module-type warning is acceptable if command succeeds.

**Step 4: Commit**

```bash
git add apps/web/lib/crypto.js
git commit -m "feat: add credential decrypt helper"
```

---

## Task 2: Add provider health helper

**Files:**
- Create: `apps/web/lib/provider-health.js`

**Step 1: Create helper**

Create `apps/web/lib/provider-health.js`:

```js
export function normalizeOpenAIBaseUrl(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) throw new Error('missing provider base URL');

  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

export function buildChatCompletionsUrl(baseUrl) {
  return `${normalizeOpenAIBaseUrl(baseUrl)}/v1/chat/completions`;
}

export function sanitizeProviderFailure(error) {
  if (error?.name === 'AbortError') return 'Provider request timed out';
  return 'Provider request failed';
}

export async function runOpenAICompatibleHealthCheck({ baseUrl, apiKey, model, fetchImpl = fetch, timeoutMs = 10000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(buildChatCompletionsUrl(baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      })
    });

    if (!response.ok) {
      return {
        ok: false,
        error_code: 'provider_check_failed',
        message: `Provider returned ${response.status}`
      };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return {
        ok: false,
        error_code: 'provider_invalid_response',
        message: 'Provider returned an invalid response'
      };
    }

    return { ok: true, message: 'Provider check passed' };
  } catch (error) {
    return {
      ok: false,
      error_code: error?.name === 'AbortError' ? 'provider_check_timeout' : 'provider_check_failed',
      message: sanitizeProviderFailure(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
```

**Step 2: Verify helper manually**

Run:

```bash
node -e "import('./apps/web/lib/provider-health.js').then(m => console.log(m.buildChatCompletionsUrl('https://api.example.com/')))"
```

Expected:

```text
https://api.example.com/v1/chat/completions
```

Optionally verify mocked fetch:

```bash
node -e "import('./apps/web/lib/provider-health.js').then(async m => { const r = await m.runOpenAICompatibleHealthCheck({ baseUrl:'https://api.example.com', apiKey:'x', model:'gpt-test', fetchImpl: async () => ({ ok: true, json: async () => ({ id:'ok' }) }) }); console.log(JSON.stringify(r)); })"
```

Expected:

```json
{"ok":true,"message":"Provider check passed"}
```

**Step 3: Commit**

```bash
git add apps/web/lib/provider-health.js
git commit -m "feat: add provider health probe helper"
```

---

## Task 3: Add provider health check API route

**Files:**
- Create: `apps/web/app/api/providers/[id]/check/route.js`

**Step 1: Inspect existing provider routes**

Read:

```bash
sed -n '1,240p' apps/web/app/api/providers/route.js
sed -n '1,220p' apps/web/app/api/providers/[id]/route.js
sed -n '1,220p' apps/web/lib/supabase-admin.js
```

Match existing response/error patterns and helper signatures.

**Step 2: Create route**

Create `apps/web/app/api/providers/[id]/check/route.js`.

Recommended implementation shape:

```js
import { NextResponse } from 'next/server';
import { decryptCredential } from '../../../../../lib/crypto.js';
import { runOpenAICompatibleHealthCheck } from '../../../../../lib/provider-health.js';
import { supabasePatch, supabaseSelect } from '../../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../../lib/workspace.js';

export async function POST(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: { code: 'validation_error', message: 'Provider id is required' } }, { status: 400 });
    }

    const providers = await supabaseSelect(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,auth_method,status,metadata,credential_encrypted,quota_state,last_checked_at&limit=1`
    );

    if (providers.length === 0) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Provider not found' } }, { status: 404 });
    }

    const provider = providers[0];
    if (provider.status === 'disconnected') {
      return NextResponse.json({ error: { code: 'validation_error', message: 'Disconnected providers cannot be checked' } }, { status: 400 });
    }

    if (provider.provider_type !== 'openai_compatible' || provider.auth_method !== 'api_key') {
      return NextResponse.json({ error: { code: 'validation_error', message: 'Provider health checks only support OpenAI-compatible API-key providers' } }, { status: 400 });
    }

    const apiKey = await decryptCredential(provider.credential_encrypted);
    const metadata = provider.metadata || {};
    const result = await runOpenAICompatibleHealthCheck({
      baseUrl: metadata.base_url,
      apiKey,
      model: metadata.default_model
    });

    const checkedAt = new Date().toISOString();
    const quotaState = {
      ...(provider.quota_state || {}),
      health: result.ok ? 'healthy' : 'error',
      last_error_code: result.ok ? null : result.error_code,
      last_error_message: result.ok ? null : result.message
    };

    const patch = {
      status: result.ok ? 'active' : 'error',
      last_checked_at: checkedAt,
      quota_state: quotaState
    };

    const updated = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      patch
    );

    const row = updated[0] || patch;

    return NextResponse.json({
      id,
      status: row.status || patch.status,
      health: quotaState.health,
      last_checked_at: row.last_checked_at || checkedAt,
      ...(result.ok ? { message: result.message } : { error_code: result.error_code, message: result.message })
    });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || 'provider_check_error';
    return NextResponse.json({ error: { code, message: error.message || 'Provider check failed' } }, { status });
  }
}
```

Adjust for existing `params` style if the repo's Next version/lint expects non-awaited params.

**Step 3: Verify build route appears**

Run:

```bash
npm run build:web
```

Expected routes include:

```text
/api/providers/[id]/check
```

**Step 4: Run lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/app/api/providers/[id]/check/route.js
git commit -m "feat: add provider health check api"
```

---

## Task 4: Display health state in dashboard

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add health action state**

The dashboard already has `pendingActionId`. Reuse it with prefix:

```text
provider-check:<providerId>
```

No new state is required unless you want a separate message. Reuse `managementStatus`.

**Step 2: Add check function**

Inside `DashboardClient`, near `disconnectProvider`, add:

```js
async function checkProviderHealth(providerId) {
  setPendingActionId(`provider-check:${providerId}`);
  setManagementStatus(null);
  try {
    const response = await fetch(`/api/providers/${providerId}/check`, {
      method: 'POST',
      headers: await authenticatedJsonHeaders()
    });
    const data = await parseJsonResponse(response, 'Failed to check provider health');
    setManagementStatus({
      type: data.health === 'healthy' ? 'success' : 'error',
      message: data.message || 'Provider health check completed'
    });
    await loadResources();
  } catch (error) {
    setManagementStatus({ type: 'error', message: error.message || 'Failed to check provider health' });
  } finally {
    setPendingActionId(null);
  }
}
```

**Step 3: Render health fields**

In each provider card, add:

```jsx
<span>Health: {provider.quota_state?.health || 'unknown'}</span>
<span>Last checked: {formatDate(provider.last_checked_at)}</span>
{provider.quota_state?.last_error_message ? <span>Last error: {provider.quota_state.last_error_message}</span> : null}
```

**Step 4: Add Check health button**

For non-disconnected providers, add a button near Disconnect:

```jsx
<button style={buttonStyle} disabled={pendingActionId === `provider-check:${provider.id}`} onClick={() => checkProviderHealth(provider.id)} type="button">
  {pendingActionId === `provider-check:${provider.id}` ? 'Checking…' : 'Check health'}
</button>
```

Keep Disconnect button behavior unchanged.

**Step 5: Verify lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: show provider health in dashboard"
```

---

## Task 5: Update docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: README**

Add current thin slice bullet:

```md
- Dashboard can run provider health checks and display provider health state
```

Update next build steps by removing provider health checks and promoting preset editor:

```md
## Next Build Steps
1. Add preset editor UI
2. Add production cookie/SSR auth polish and workspace switching
3. Add token/cost accounting improvements
4. Add provider reconnect flow
```

**Step 2: API contract**

Add section after `DELETE /api/providers/:id`:

```md
### `POST /api/providers/:id/check`
Runs a manual health check for an OpenAI-compatible API-key provider.

**Response `200` healthy**
```json
{
  "id": "uuid",
  "status": "active",
  "health": "healthy",
  "last_checked_at": "2026-05-01T00:00:00Z",
  "message": "Provider check passed"
}
```

**Response `200` unhealthy**
```json
{
  "id": "uuid",
  "status": "error",
  "health": "error",
  "last_checked_at": "2026-05-01T00:00:00Z",
  "error_code": "provider_check_failed",
  "message": "Provider returned 401"
}
```

**Errors:** `401` unauthorized, `404` not found, `400` validation error
```

Also update `GET /api/providers` response example to include `quota_state.health` and `last_checked_at` if not already present.

**Step 3: SETUP**

Add dashboard smoke test:

```md
Use the provider card's `Check health` button to run a tiny chat-completion probe. Valid providers should become `active/healthy`; invalid credentials or base URLs become `error` with a sanitized message.
```

**Step 4: BACKLOG**

Add notes:

```md
- Provider health check thin slice is implemented in `/dashboard` (manual check + status display).
```

Optionally mark P0 Provider health status as implemented if the file uses checkbox status.

**Step 5: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document provider health checks"
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
/api/providers/[id]/check
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
git commit -m "chore: finalize provider health checks slice"
```

---

## Manual Smoke Test With Supabase

With Supabase env configured:

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Log in and open `/dashboard`.
3. Connect a valid OpenAI-compatible provider.
4. Click `Check health`.
5. Confirm provider shows:
   ```text
   Status: active
   Health: healthy
   Last checked: <timestamp>
   ```
6. Connect a provider with invalid credential or base URL.
7. Click `Check health`.
8. Confirm provider shows:
   ```text
   Status: error
   Health: error
   Last error: Provider returned 401
   ```
   or another sanitized error.

---

## Deferred Work

Do not implement these in this plan:

- Scheduled checks.
- Provider reconnect/credential rotation.
- Provider-specific adapters.
- `/v1/models` probe.
- Detailed latency/quota metrics.
- Cost accounting for health probe calls.
- DB migrations.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-provider-health-checks-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-provider-health-checks-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
