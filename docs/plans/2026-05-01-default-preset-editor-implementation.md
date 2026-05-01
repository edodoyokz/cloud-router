# Default Preset / Fallback Chain Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dashboard editor and API support for the active workspace's default routing preset/fallback chain.

**Architecture:** Add Supabase delete support, a preset helper module, `GET`/`PUT` route handlers for `/api/presets/default`, then extend the dashboard client with independent preset state and a local-draft editor. The router already reads default preset steps by order, so no router data-plane changes are expected.

**Tech Stack:** Next.js 16 App Router, React 19 dashboard client, Supabase PostgREST admin helper, existing hybrid workspace resolver, existing Go router tests.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-default-preset-editor-design.md
```

Relevant files:

```text
apps/web/lib/supabase-admin.js
apps/web/app/api/providers/route.js
apps/web/app/dashboard/dashboard-client.jsx
docs/API_CONTRACT.md
README.md
docs/SETUP.md
docs/BACKLOG.md
services/router/internal/store/supabase.go
services/router/internal/store/memory.go
```

Current behavior:

- Provider creation ensures a default preset exists and appends the provider to it.
- Router reads the default preset and ordered preset steps.
- Dashboard lists providers but cannot edit the fallback chain.
- No `/api/presets/default` route exists yet.

Constraints:

- Default preset editor only; no full multi-preset CRUD.
- `fallback_mode` is always `failover`.
- No DB migrations.
- Do not expose credentials or API key hashes.
- Keep preset errors scoped to the preset editor section.

---

## Task 1: Add Supabase delete helper

**Files:**
- Modify: `apps/web/lib/supabase-admin.js`

**Step 1: Add export**

Add after `supabasePatch`:

```js
export async function supabaseDelete(table, query) {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method: 'DELETE',
    headers: jsonHeaders(serviceKey)
  });
  return parseSupabaseResponse(response);
}
```

Existing `jsonHeaders` includes `Prefer: return=representation`, which is acceptable.

**Step 2: Run lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/web/lib/supabase-admin.js
git commit -m "feat: add supabase delete helper"
```

---

## Task 2: Add preset helper module

**Files:**
- Create: `apps/web/lib/presets.js`

**Step 1: Create helper module**

Create `apps/web/lib/presets.js` with these imports:

```js
import { supabaseDelete, supabaseInsert, supabaseSelect } from './supabase-admin.js';
```

**Step 2: Add helpers**

Implement:

```js
const maxPresetSteps = 10;

export async function ensureDefaultPreset(workspaceId) {
  const existing = await supabaseSelect(
    'routing_presets',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&is_default=eq.true&select=*&limit=1`
  );
  if (existing.length > 0) return existing[0];

  const [created] = await supabaseInsert('routing_presets', [{
    workspace_id: workspaceId,
    name: 'Default',
    description: 'Default routing preset',
    is_default: true
  }]);
  return created;
}

export function normalizePresetStepInput(steps) {
  if (!Array.isArray(steps)) {
    throw Object.assign(new Error('steps must be an array'), { status: 400, code: 'validation_error' });
  }
  if (steps.length > maxPresetSteps) {
    throw Object.assign(new Error(`default preset supports at most ${maxPresetSteps} steps`), { status: 400, code: 'validation_error' });
  }

  const seen = new Set();
  return steps.map((step) => {
    const providerId = String(step?.provider_connection_id || '').trim();
    if (!providerId) {
      throw Object.assign(new Error('provider_connection_id is required'), { status: 400, code: 'validation_error' });
    }
    if (seen.has(providerId)) {
      throw Object.assign(new Error('provider_connection_id values must be unique'), { status: 400, code: 'validation_error' });
    }
    seen.add(providerId);

    const rawAlias = step?.model_alias;
    const modelAlias = rawAlias == null ? null : String(rawAlias).trim();
    if (modelAlias && modelAlias.length > 128) {
      throw Object.assign(new Error('model_alias must be at most 128 characters'), { status: 400, code: 'validation_error' });
    }

    return {
      provider_connection_id: providerId,
      model_alias: modelAlias || null
    };
  });
}
```

Implement provider loading/enrichment:

```js
async function providersById(workspaceId, providerIds) {
  if (providerIds.length === 0) return new Map();
  const rows = await supabaseSelect(
    'provider_connections',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=in.(${providerIds.map(encodeURIComponent).join(',')})&select=id,provider_type,display_name,status,quota_state,metadata`
  );
  return new Map(rows.map((provider) => [provider.id, provider]));
}

function enrichStep(step, provider) {
  return {
    id: step.id,
    order_index: step.order_index,
    provider_connection_id: step.provider_connection_id,
    provider_type: provider?.provider_type || null,
    display_name: provider?.display_name || 'Unknown provider',
    status: provider?.status || 'missing',
    health: provider?.quota_state?.health || 'unknown',
    model_alias: step.model_alias || null,
    fallback_mode: step.fallback_mode || 'failover'
  };
}
```

Implement read:

```js
export async function getDefaultPresetWithSteps(workspaceId) {
  const preset = await ensureDefaultPreset(workspaceId);
  const steps = await supabaseSelect(
    'routing_preset_steps',
    `?preset_id=eq.${encodeURIComponent(preset.id)}&select=id,order_index,provider_connection_id,model_alias,fallback_mode&order=order_index.asc`
  );
  const providerIds = steps.map((step) => step.provider_connection_id);
  const providerMap = await providersById(workspaceId, providerIds);

  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    is_default: preset.is_default,
    steps: steps.map((step) => enrichStep(step, providerMap.get(step.provider_connection_id)))
  };
}
```

Implement replacement:

```js
export async function replaceDefaultPresetSteps(workspaceId, rawSteps) {
  const preset = await ensureDefaultPreset(workspaceId);
  const steps = normalizePresetStepInput(rawSteps);
  const providerIds = steps.map((step) => step.provider_connection_id);
  const providerMap = await providersById(workspaceId, providerIds);

  for (const providerId of providerIds) {
    const provider = providerMap.get(providerId);
    if (!provider) {
      throw Object.assign(new Error('Provider not found'), { status: 404, code: 'not_found' });
    }
    if (provider.status === 'disconnected') {
      throw Object.assign(new Error('Disconnected providers cannot be added to the default preset'), { status: 400, code: 'validation_error' });
    }
  }

  await supabaseDelete('routing_preset_steps', `?preset_id=eq.${encodeURIComponent(preset.id)}`);

  if (steps.length > 0) {
    await supabaseInsert('routing_preset_steps', steps.map((step, index) => ({
      preset_id: preset.id,
      order_index: index + 1,
      provider_connection_id: step.provider_connection_id,
      model_alias: step.model_alias,
      fallback_mode: 'failover'
    })));
  }

  return getDefaultPresetWithSteps(workspaceId);
}
```

**Important:** PostgREST `id=in.(...)` UUID syntax should work with comma-separated UUIDs. If testing reveals quoting is needed, adjust accordingly.

**Step 3: Manual helper check**

Run a syntax/import check:

```bash
node -e "import('./apps/web/lib/presets.js').then(m => console.log(typeof m.normalizePresetStepInput, JSON.stringify(m.normalizePresetStepInput([]))))"
```

Expected:

```text
function []
```

Module-type warning is acceptable if command succeeds.

**Step 4: Commit**

```bash
git add apps/web/lib/presets.js
git commit -m "feat: add default preset helpers"
```

---

## Task 3: Add default preset API route

**Files:**
- Create: `apps/web/app/api/presets/default/route.js`

**Step 1: Create route**

Create `apps/web/app/api/presets/default/route.js`:

```js
import { NextResponse } from 'next/server';
import { getDefaultPresetWithSteps, replaceDefaultPresetSteps } from '../../../../lib/presets.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const preset = await getDefaultPresetWithSteps(workspaceId);
    return NextResponse.json(preset);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function PUT(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const body = await request.json();
    const preset = await replaceDefaultPresetSteps(workspaceId, body?.steps);
    return NextResponse.json(preset);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 2: Build route check**

Run:

```bash
npm run build:web
```

Expected route list includes:

```text
/api/presets/default
```

**Step 3: Lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/app/api/presets/default/route.js
git commit -m "feat: add default preset api"
```

---

## Task 4: Add dashboard preset loading/state

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add preset state**

Near other state declarations, add:

```js
const [preset, setPreset] = useState(null);
const [presetDraftSteps, setPresetDraftSteps] = useState([]);
const [presetStatus, setPresetStatus] = useState(null);
const [loadingPreset, setLoadingPreset] = useState(false);
const [savingPreset, setSavingPreset] = useState(false);
const [addPresetProviderId, setAddPresetProviderId] = useState('');
const [addPresetModelAlias, setAddPresetModelAlias] = useState('');
```

**Step 2: Add draft helper**

Add outside component or inside component:

```js
function draftStepsFromPreset(presetData) {
  return (presetData?.steps || []).map((step) => ({
    provider_connection_id: step.provider_connection_id,
    display_name: step.display_name,
    status: step.status,
    health: step.health,
    model_alias: step.model_alias || ''
  }));
}
```

**Step 3: Add load callback**

Inside component:

```js
const loadPreset = useCallback(async function loadPreset() {
  setLoadingPreset(true);
  setPresetStatus(null);
  try {
    const response = await fetch('/api/presets/default', {
      headers: await authenticatedJsonHeaders()
    });
    const data = await parseJsonResponse(response, 'Failed to load default preset');
    setPreset(data);
    setPresetDraftSteps(draftStepsFromPreset(data));
  } catch (error) {
    setPresetStatus({ type: 'error', message: error.message || 'Failed to load default preset' });
  } finally {
    setLoadingPreset(false);
  }
}, [authenticatedJsonHeaders]);
```

**Step 4: Add initial effect without lint violation**

Use async/cancelled pattern like resources and usage:

```js
useEffect(() => {
  let cancelled = false;

  async function loadInitialPreset() {
    try {
      const headers = await authenticatedJsonHeaders();
      if (cancelled) return;
      setLoadingPreset(true);
      setPresetStatus(null);

      const response = await fetch('/api/presets/default', { headers });
      const data = await parseJsonResponse(response, 'Failed to load default preset');
      if (cancelled) return;
      setPreset(data);
      setPresetDraftSteps(draftStepsFromPreset(data));
    } catch (error) {
      if (!cancelled) setPresetStatus({ type: 'error', message: error.message || 'Failed to load default preset' });
    } finally {
      if (!cancelled) setLoadingPreset(false);
    }
  }

  loadInitialPreset();

  return () => {
    cancelled = true;
  };
}, [authenticatedJsonHeaders]);
```

**Step 5: Add draft actions**

Inside component:

```js
function updateDraftModelAlias(index, value) {
  setPresetDraftSteps((current) => current.map((step, stepIndex) => (
    stepIndex === index ? { ...step, model_alias: value } : step
  )));
}

function moveDraftStep(index, direction) {
  setPresetDraftSteps((current) => {
    const next = [...current];
    const target = index + direction;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
}

function removeDraftStep(index) {
  setPresetDraftSteps((current) => current.filter((_, stepIndex) => stepIndex !== index));
}

function resetPresetDraft() {
  setPresetDraftSteps(draftStepsFromPreset(preset));
  setPresetStatus(null);
}
```

**Step 6: Add add/save actions**

Inside component:

```js
function addProviderToDraft() {
  const provider = providers.find((item) => item.id === addPresetProviderId);
  if (!provider) return;
  setPresetDraftSteps((current) => [
    ...current,
    {
      provider_connection_id: provider.id,
      display_name: provider.display_name,
      status: provider.status,
      health: provider.quota_state?.health || 'unknown',
      model_alias: addPresetModelAlias.trim()
    }
  ]);
  setAddPresetProviderId('');
  setAddPresetModelAlias('');
}

async function savePresetChain() {
  setSavingPreset(true);
  setPresetStatus(null);
  try {
    const response = await fetch('/api/presets/default', {
      method: 'PUT',
      headers: await authenticatedJsonHeaders(),
      body: JSON.stringify({
        steps: presetDraftSteps.map((step) => ({
          provider_connection_id: step.provider_connection_id,
          model_alias: step.model_alias?.trim() || null
        }))
      })
    });
    const data = await parseJsonResponse(response, 'Failed to save default preset');
    setPreset(data);
    setPresetDraftSteps(draftStepsFromPreset(data));
    setPresetStatus({ type: 'success', message: 'Default fallback chain saved.' });
  } catch (error) {
    setPresetStatus({ type: 'error', message: error.message || 'Failed to save default preset' });
  } finally {
    setSavingPreset(false);
  }
}
```

**Step 7: Ensure no unused functions/state**

If lint flags any unused declarations, either use them in Task 5 immediately or combine Task 4 and Task 5 into one commit.

**Step 8: Run lint**

```bash
npm run lint:web
```

Expected: PASS, unless UI from Task 5 is needed to use functions. If lint fails due unused declarations, continue Task 5 before committing.

**Step 9: Commit**

If lint passes:

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: load default preset in dashboard"
```

If Task 5 is needed to avoid unused lint, skip this commit and make one combined commit after Task 5:

```bash
git commit -m "feat: edit default fallback chain in dashboard"
```

---

## Task 5: Render dashboard preset editor

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Compute available providers**

Inside component before `return`, add:

```js
const draftProviderIds = new Set(presetDraftSteps.map((step) => step.provider_connection_id));
const availablePresetProviders = providers.filter((provider) => (
  provider.status !== 'disconnected' && !draftProviderIds.has(provider.id)
));
```

If React lint dislikes non-memo computed Set, this is fine unless performance warnings appear.

**Step 2: Add JSX section**

Place this section after `Connected providers` or before it:

```jsx
<section style={cardStyle}>
  <div>
    <h2 style={{ margin: 0 }}>Default fallback chain</h2>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Router tries providers in this order for model <code>auto</code>.</p>
  </div>

  {presetStatus ? <StatusMessage status={presetStatus} /> : null}
  {loadingPreset ? <p>Loading default preset…</p> : null}

  <div style={{ display: 'grid', gap: 12 }}>
    {presetDraftSteps.length === 0 && !loadingPreset ? <p style={{ color: '#4b5563' }}>No providers in the fallback chain yet.</p> : null}
    {presetDraftSteps.map((step, index) => (
      <div key={step.provider_connection_id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
        <strong>#{index + 1} {step.display_name}</strong>
        <span>Status: {step.status}</span>
        <span>Health: {step.health || 'unknown'}</span>
        {step.status === 'error' ? <span style={{ color: '#92400e' }}>Warning: this provider is currently marked error.</span> : null}
        <label style={labelStyle}>
          Model override optional
          <input
            style={inputStyle}
            value={step.model_alias || ''}
            onChange={(event) => updateDraftModelAlias(index, event.target.value)}
            placeholder="provider default"
          />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={buttonStyle} type="button" onClick={() => moveDraftStep(index, -1)} disabled={index === 0}>Move up</button>
          <button style={buttonStyle} type="button" onClick={() => moveDraftStep(index, 1)} disabled={index === presetDraftSteps.length - 1}>Move down</button>
          <button style={buttonStyle} type="button" onClick={() => removeDraftStep(index)}>Remove</button>
        </div>
      </div>
    ))}
  </div>

  <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
    <strong>Add provider to chain</strong>
    <label style={labelStyle}>
      Provider
      <select style={inputStyle} value={addPresetProviderId} onChange={(event) => setAddPresetProviderId(event.target.value)}>
        <option value="">Select provider…</option>
        {availablePresetProviders.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.display_name} — {provider.status} / {provider.quota_state?.health || 'unknown'}
          </option>
        ))}
      </select>
    </label>
    <label style={labelStyle}>
      Model override optional
      <input
        style={inputStyle}
        value={addPresetModelAlias}
        onChange={(event) => setAddPresetModelAlias(event.target.value)}
        placeholder="provider default"
      />
    </label>
    <button style={buttonStyle} type="button" onClick={addProviderToDraft} disabled={!addPresetProviderId}>Add to chain</button>
  </div>

  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <button style={buttonStyle} type="button" onClick={savePresetChain} disabled={savingPreset}>
      {savingPreset ? 'Saving…' : 'Save chain'}
    </button>
    <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={resetPresetDraft} disabled={savingPreset}>
      Reset changes
    </button>
    <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={loadPreset} disabled={loadingPreset || savingPreset}>
      Refresh chain
    </button>
  </div>
</section>
```

**Step 3: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

If lint flags `Set` creation or function ordering, adjust minimally.

**Step 4: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: edit default fallback chain in dashboard"
```

---

## Task 6: Update docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: README**

Add current thin slice bullet:

```md
- Dashboard can edit the default fallback chain used by the router
```

Update next build steps:

```md
## Next Build Steps
1. Add production cookie/SSR auth polish and workspace switching
2. Add token/cost accounting improvements
3. Add provider reconnect flow
4. Add richer onboarding snippets for Claude Code / Codex / OpenClaw / Cursor
```

**Step 2: API contract**

Add sections:

```md
### `GET /api/presets/default`
Returns the active workspace's default routing preset and enriched fallback chain.
```

with response matching design.

```md
### `PUT /api/presets/default`
Replaces the default fallback chain.
```

with request/response matching design.

Keep existing `GET /api/presets` and `POST /api/presets` sections if present as future contract, or note that the implemented MVP route is `/api/presets/default`.

**Step 3: SETUP**

Add manual smoke steps:

```md
Open `/dashboard`, use Default fallback chain to reorder providers, save, refresh, and confirm the order persists. The router uses this default chain for `model: "auto"` requests.
```

**Step 4: BACKLOG**

Mark P0 items as done:

```md
- [x] Preset routing creator
- [x] Fallback chain working end-to-end
```

Add note:

```md
- Default fallback chain editor is implemented in `/dashboard`.
```

**Step 5: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document default preset editor"
```

---

## Task 7: Final verification

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
/api/presets/default
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
git commit -m "chore: finalize default preset editor slice"
```

---

## Manual Smoke Test With Supabase

With Supabase env configured:

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Start router:
   ```bash
   npm run dev:router
   ```
3. Log in and open `/dashboard`.
4. Connect at least two providers.
5. Confirm both appear in Default fallback chain or add missing provider manually.
6. Move provider order and save.
7. Refresh page and confirm order persists.
8. Remove provider from chain and save.
9. Add provider back with model override and save.
10. Send a router request with:
    ```json
    { "model": "auto", "messages": [{ "role": "user", "content": "hello" }] }
    ```
11. Confirm router still uses default chain and usage events continue to write.

---

## Deferred Work

Do not implement these in this plan:

- Full preset CRUD.
- Active/default preset selector.
- Drag-and-drop.
- Round-robin/sticky routing UI.
- Provider tags/pricing-aware routing.
- Workspace switching.
- Auth cookie/SSR polish.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-default-preset-editor-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-default-preset-editor-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
