# Provider Tags Routing Hints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add fixed provider tags (`primary`, `backup`, `free`, `cheap`) as dashboard-visible routing hints stored in provider metadata.

**Architecture:** Store tags in `provider_connections.metadata.tags` without schema changes. Add shared normalization helpers, extend provider create/reconnect APIs to preserve tags, add a dedicated tag update route, and render/edit tags in the dashboard provider list and fallback-chain editor.

**Tech Stack:** Next.js App Router, React client component, Supabase REST helper, plain JavaScript helpers, existing provider metadata JSON.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-provider-tags-routing-hints-design.md
```

Relevant files:

```text
apps/web/app/api/providers/route.js
apps/web/app/api/providers/[id]/route.js
apps/web/app/dashboard/dashboard-client.jsx
apps/web/lib/provider-validation.js
apps/web/lib/supabase-admin.js
docs/API_CONTRACT.md
docs/BACKLOG.md
docs/DB_SCHEMA.md
docs/SETUP.md
README.md
```

Current provider metadata shape:

```json
{
  "base_url": "https://api.openai.com",
  "default_model": "gpt-4o-mini"
}
```

Target provider metadata shape:

```json
{
  "base_url": "https://api.openai.com",
  "default_model": "gpt-4o-mini",
  "tags": ["primary", "cheap"]
}
```

Constraints:

- No DB migration.
- No router behavior change.
- No automatic fallback ordering.
- No custom tags.
- Provider credentials must never be returned.

---

## Task 1: Add provider tag helper

**Files:**
- Create: `apps/web/lib/provider-tags.js`

### Step 1: Create helper file

Create `apps/web/lib/provider-tags.js`:

```js
export const ALLOWED_PROVIDER_TAGS = ['primary', 'backup', 'free', 'cheap'];

const tagLabels = {
  primary: 'Primary',
  backup: 'Backup',
  free: 'Free',
  cheap: 'Cheap'
};

export function normalizeProviderTags(value) {
  if (!Array.isArray(value)) return [];
  const input = new Set(
    value
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => ALLOWED_PROVIDER_TAGS.includes(tag))
  );

  return ALLOWED_PROVIDER_TAGS.filter((tag) => input.has(tag));
}

export function providerTagLabel(tag) {
  return tagLabels[tag] || tag;
}

export function mergeProviderMetadataTags(metadata, tags) {
  const current = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return {
    ...current,
    tags: normalizeProviderTags(tags)
  };
}
```

### Step 2: Lint

Run:

```bash
npm run lint:web
```

Expected: PASS.

### Step 3: Commit

```bash
git add apps/web/lib/provider-tags.js
git commit -m "feat: add provider tag helpers"
```

---

## Task 2: Store tags on provider create and preserve tags on reconnect

**Files:**
- Modify: `apps/web/app/api/providers/route.js`
- Modify: `apps/web/app/api/providers/[id]/route.js`

### Step 1: Update create route imports

In `apps/web/app/api/providers/route.js`, add:

```js
import { normalizeProviderTags } from '../../../lib/provider-tags.js';
```

### Step 2: Store tags on create

In `POST`, after `const input = normalizeProviderInput(body);`, add:

```js
const tags = normalizeProviderTags(body.tags);
```

Change inserted metadata from:

```js
metadata: { base_url: input.base_url, default_model: input.default_model },
```

to:

```js
metadata: { base_url: input.base_url, default_model: input.default_model, tags },
```

Response can continue returning `metadata: provider.metadata`.

### Step 3: Preserve tags on reconnect

In `apps/web/app/api/providers/[id]/route.js`, add import:

```js
import { normalizeProviderTags } from '../../../../lib/provider-tags.js';
```

Change existing provider select from:

```js
select=id,provider_type,auth_method,created_at&limit=1
```

to:

```js
select=id,provider_type,auth_method,metadata,created_at&limit=1
```

After `const input = normalizeProviderInput(...)`, add:

```js
const tags = Object.prototype.hasOwnProperty.call(body, 'tags')
  ? normalizeProviderTags(body.tags)
  : normalizeProviderTags(provider.metadata?.tags);
```

Change patch metadata from:

```js
metadata: { base_url: input.base_url, default_model: input.default_model },
```

to:

```js
metadata: { ...(provider.metadata || {}), base_url: input.base_url, default_model: input.default_model, tags },
```

This preserves future metadata keys as well as tags.

### Step 4: Verify

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/web/app/api/providers/route.js apps/web/app/api/providers/[id]/route.js
git commit -m "feat: store provider tags in metadata"
```

---

## Task 3: Add provider tags update route

**Files:**
- Create: `apps/web/app/api/providers/[id]/tags/route.js`

### Step 1: Create directory

```bash
mkdir -p apps/web/app/api/providers/[id]/tags
```

### Step 2: Create route

Create `apps/web/app/api/providers/[id]/tags/route.js`:

```js
import { NextResponse } from 'next/server';
import { normalizeProviderTags } from '../../../../../lib/provider-tags.js';
import { supabasePatch, supabaseSelect } from '../../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../../lib/workspace.js';

function providerResponse(provider) {
  return {
    id: provider.id,
    provider_type: provider.provider_type,
    display_name: provider.display_name,
    auth_method: provider.auth_method,
    status: provider.status,
    metadata: provider.metadata,
    quota_state: provider.quota_state,
    last_checked_at: provider.last_checked_at,
    created_at: provider.created_at
  };
}

export async function PATCH(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('provider id is required'), { status: 400, code: 'validation_error' });

    const body = await request.json();
    if (!Object.prototype.hasOwnProperty.call(body, 'tags') || !Array.isArray(body.tags)) {
      throw Object.assign(new Error('tags array is required'), { status: 400, code: 'validation_error' });
    }

    const existing = await supabaseSelect(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,metadata&limit=1`
    );
    if (existing.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    const metadata = {
      ...(existing[0].metadata || {}),
      tags: normalizeProviderTags(body.tags)
    };

    const rows = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { metadata }
    );

    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    return NextResponse.json(providerResponse(rows[0]));
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

### Step 3: Verify

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS. Build should include:

```text
/api/providers/[id]/tags
```

### Step 4: Commit

```bash
git add apps/web/app/api/providers/[id]/tags/route.js
git commit -m "feat: add provider tags api"
```

---

## Task 4: Add dashboard tag editing and tag hints

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

### Step 1: Import helper constants

Add import near other imports:

```js
import { ALLOWED_PROVIDER_TAGS, normalizeProviderTags, providerTagLabel } from '../../lib/provider-tags.js';
```

### Step 2: Add provider form tag state

Initial `providerForm` currently has:

```js
const [providerForm, setProviderForm] = useState({
  display_name: 'My OpenAI-compatible Provider',
  base_url: 'https://api.openai.com',
  default_model: 'gpt-4o-mini',
  api_key: ''
});
```

Add:

```js
tags: []
```

### Step 3: Add provider tag draft state

Near other state:

```js
const [providerTagDrafts, setProviderTagDrafts] = useState({});
```

### Step 4: Add tag helper functions inside component

Add after `updateProviderField`:

```js
function providerTags(provider) {
  return normalizeProviderTags(provider?.metadata?.tags);
}

function toggleTagList(tags, tag) {
  const current = new Set(normalizeProviderTags(tags));
  if (current.has(tag)) current.delete(tag);
  else current.add(tag);
  return normalizeProviderTags(Array.from(current));
}

function toggleProviderFormTag(tag) {
  setProviderForm((current) => ({ ...current, tags: toggleTagList(current.tags, tag) }));
}

function providerTagDraft(provider) {
  return providerTagDrafts[provider.id] || providerTags(provider);
}

function toggleProviderDraftTag(provider, tag) {
  setProviderTagDrafts((current) => ({
    ...current,
    [provider.id]: toggleTagList(current[provider.id] || providerTags(provider), tag)
  }));
}
```

### Step 5: Add tag chips component outside DashboardClient

Add before `DashboardClient`:

```jsx
function ProviderTagChips({ tags }) {
  const normalized = normalizeProviderTags(tags);
  if (normalized.length === 0) return <span style={{ color: '#6b7280' }}>No tags</span>;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {normalized.map((tag) => (
        <span key={tag} style={{ border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
          {providerTagLabel(tag)}
        </span>
      ))}
    </span>
  );
}
```

### Step 6: Add reusable tag toggle group component outside DashboardClient

Add:

```jsx
function ProviderTagToggleGroup({ selectedTags, onToggle, disabled = false }) {
  const selected = normalizeProviderTags(selectedTags);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {ALLOWED_PROVIDER_TAGS.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            disabled={disabled}
            style={{
              border: `1px solid ${active ? '#2563eb' : '#d0d7de'}`,
              background: active ? '#eff6ff' : '#fff',
              color: active ? '#1e40af' : '#374151',
              borderRadius: 999,
              padding: '6px 10px',
              fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
          >
            {providerTagLabel(tag)}
          </button>
        );
      })}
    </div>
  );
}
```

### Step 7: Include tags in provider create payload

In `connectProvider`, payload currently spreads `providerForm`. Since `providerForm.tags` is added, it will submit automatically. After success reset API key only. Keep tags intact unless you prefer clearing tags. Recommended: clear API key only, preserve selected tags for repeated similar providers.

No code needed beyond adding tags to state.

### Step 8: Add tag input UI to provider connect form

Find provider connect form JSX. Add below default model input:

```jsx
<label style={labelStyle}>
  Routing hint tags
  <ProviderTagToggleGroup selectedTags={providerForm.tags} onToggle={toggleProviderFormTag} disabled={providerPending} />
</label>
```

### Step 9: Add saveProviderTags function

Inside component near other API actions:

```js
async function saveProviderTags(provider) {
  setPendingActionId(`provider-tags:${provider.id}`);
  setManagementStatus(null);
  try {
    const response = await fetch(`/api/providers/${provider.id}/tags`, {
      method: 'PATCH',
      headers: await authenticatedJsonHeaders(),
      body: JSON.stringify({ tags: providerTagDraft(provider) })
    });
    await parseJsonResponse(response, 'Failed to save provider tags');
    setManagementStatus({ type: 'success', message: 'Provider tags saved.' });
    setProviderTagDrafts((current) => {
      const next = { ...current };
      delete next[provider.id];
      return next;
    });
    await loadResources();
    await loadPreset();
  } catch (error) {
    setManagementStatus({ type: 'error', message: error.message || 'Failed to save provider tags' });
  } finally {
    setPendingActionId(null);
  }
}
```

### Step 10: Render tags in provider list

Find provider list rendering. In each provider card/row, add:

```jsx
<div style={{ display: 'grid', gap: 8 }}>
  <strong>Routing hints</strong>
  <ProviderTagChips tags={providerTags(provider)} />
  <ProviderTagToggleGroup
    selectedTags={providerTagDraft(provider)}
    onToggle={(tag) => toggleProviderDraftTag(provider, tag)}
    disabled={pendingActionId === `provider-tags:${provider.id}`}
  />
  <button
    style={{ ...buttonStyle, width: 'fit-content' }}
    type="button"
    onClick={() => saveProviderTags(provider)}
    disabled={pendingActionId === `provider-tags:${provider.id}`}
  >
    {pendingActionId === `provider-tags:${provider.id}` ? 'Saving tags…' : 'Save tags'}
  </button>
</div>
```

Place this near status/health/check buttons, not inside credential reconnect form.

### Step 11: Show tags in fallback chain draft rows

In default preset chain rendering, each draft step has `display_name`, `status`, `health`, `model_alias`. Add:

```jsx
<ProviderTagChips tags={providers.find((provider) => provider.id === step.provider_connection_id)?.metadata?.tags} />
```

near provider name/status.

### Step 12: Show tags in add-provider select labels

In add-provider select options, change option label to include tags if possible:

```jsx
{availablePresetProviders.map((provider) => {
  const tags = providerTags(provider);
  const tagSuffix = tags.length > 0 ? ` · ${tags.map(providerTagLabel).join(', ')}` : '';
  return <option key={provider.id} value={provider.id}>{provider.display_name}{tagSuffix}</option>;
})}
```

### Step 13: Verify

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

### Step 14: Commit

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: add provider tag dashboard controls"
```

---

## Task 5: Update docs/API contract/schema/backlog

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/DB_SCHEMA.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

### README

Add feature bullet:

```md
- Dashboard can tag providers as primary, backup, free, or cheap routing hints
```

Update Next Build Steps:

```md
## Next Build Steps
1. Add better onboarding wizard with persisted checklist
2. Add password reset and OAuth provider login polish
3. Migrate Next.js middleware file convention to proxy
4. Add tag-based routing policy suggestions
```

### API_CONTRACT

Update `POST /api/providers` request example to include:

```json
"tags": ["primary", "cheap"]
```

Update provider response metadata examples to include:

```json
"metadata": {
  "base_url": "https://api.example.com",
  "default_model": "gpt-4o-mini",
  "tags": ["primary", "cheap"]
}
```

Add section:

```md
### `PATCH /api/providers/:id/tags`
Updates provider routing hint tags.

Allowed tags: `primary`, `backup`, `free`, `cheap`.
Unknown tags are ignored during normalization.

**Request**
```json
{ "tags": ["backup", "free"] }
```

**Response `200`**
```json
{
  "id": "uuid",
  "provider_type": "openai_compatible",
  "display_name": "Backup provider",
  "auth_method": "api_key",
  "status": "active",
  "metadata": {
    "base_url": "https://api.example.com",
    "default_model": "gpt-4o-mini",
    "tags": ["backup", "free"]
  },
  "quota_state": {},
  "last_checked_at": null,
  "created_at": "2026-05-01T00:00:00Z"
}
```

The response never includes `credential_encrypted` or raw credential material. Tags are routing hints only; router behavior is unchanged in this MVP slice.
```

### DB_SCHEMA

Update `provider_connections.metadata` notes:

```md
metadata | jsonb | provider metadata such as `base_url`, `default_model`, and routing hint `tags`
```

Add note below provider table:

```md
Provider routing hint tags are stored in `metadata.tags` as an array of fixed values: `primary`, `backup`, `free`, `cheap`. No separate tag table is required for MVP.
```

### SETUP

Add smoke step:

```md
Tag a provider as `primary` or `backup` in `/dashboard`, save tags, and confirm the fallback-chain editor shows those tag hints.
```

### BACKLOG

Mark provider tags complete:

```md
- [x] Provider tags: primary / backup / free / cheap
```

Add note:

```md
- Provider tag routing hints are implemented in `/dashboard` and stored in provider metadata; router policy remains manual for MVP.
```

### Commit

```bash
git add README.md docs/API_CONTRACT.md docs/DB_SCHEMA.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document provider tag routing hints"
```

---

## Task 6: Final verification

Run from repo root:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint PASS
- build PASS
- router tests PASS

Then check:

```bash
git status --short
git log --oneline --decorate -10
```

Expected:

- clean except `.pi/` if present
- commits include:
  - `feat: add provider tag helpers`
  - `feat: store provider tags in metadata`
  - `feat: add provider tags api`
  - `feat: add provider tag dashboard controls`
  - `docs: document provider tag routing hints`

---

## Manual Smoke Test

With the app configured:

1. Open `/dashboard`.
2. Connect a provider with tags `primary` and `cheap`.
3. Confirm provider list shows `Primary` and `Cheap` chips.
4. Change tags to `backup` and save.
5. Confirm provider list updates after reload.
6. Confirm no credential material appears in any response/UI.
7. Reconnect provider without editing tags.
8. Confirm tags are preserved.
9. Open default fallback-chain editor.
10. Confirm provider tag chips appear on chain rows and add-provider option labels.
11. Run a router request; behavior should remain unchanged.

---

## Deferred Work

Do not implement:

- schema migration
- router use of tags
- automatic fallback order suggestions
- provider tag analytics
- custom tags
- tag-based pricing defaults
- route policy editor

---

## Execution Handoff

Plan saved to:

```text
docs/plans/2026-05-01-provider-tags-routing-hints-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-provider-tags-routing-hints-implementation.md

Follow the plan exactly, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
