# Tag-Based Routing Policy Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dashboard tag-based fallback-chain suggestions that users can apply to the local default-chain draft before explicitly saving.

**Architecture:** Add a small pure helper for provider ordering, unit-test it with Node's built-in test runner, then integrate it into the existing dashboard fallback-chain editor. No API, database, or router behavior changes are required; the existing `PUT /api/presets/default` remains the only persistence path.

**Tech Stack:** Next.js App Router, React client component, plain JavaScript helper modules, Node test runner, existing Supabase-backed control-plane APIs, Go router unchanged.

---

## Pre-flight

Run from repo root:

```bash
git status --short
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected: lint/build/go tests pass. Existing untracked `.pi/` may remain.

---

### Task 1: Add provider routing suggestion helper with tests

**Files:**
- Create: `apps/web/lib/provider-routing-suggestions.js`
- Create: `apps/web/lib/provider-routing-suggestions.test.js`

**Step 1: Create failing tests**

Create `apps/web/lib/provider-routing-suggestions.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTagBasedFallbackSuggestion } from './provider-routing-suggestions.js';

function provider(overrides) {
  return {
    id: overrides.id,
    display_name: overrides.display_name || overrides.id,
    status: overrides.status || 'active',
    quota_state: overrides.quota_state || {},
    metadata: overrides.metadata || {}
  };
}

test('orders providers by tag priority and excludes disconnected providers', () => {
  const suggestion = buildTagBasedFallbackSuggestion([
    provider({ id: 'backup', display_name: 'Backup', metadata: { tags: ['backup'] } }),
    provider({ id: 'cheap', display_name: 'Cheap', metadata: { tags: ['cheap'] } }),
    provider({ id: 'primary', display_name: 'Primary', metadata: { tags: ['primary'] } }),
    provider({ id: 'free', display_name: 'Free', metadata: { tags: ['free'] } }),
    provider({ id: 'old', display_name: 'Old', status: 'disconnected', metadata: { tags: ['primary'] } })
  ]);

  assert.deepEqual(suggestion.steps.map((step) => step.provider_connection_id), ['primary', 'cheap', 'free', 'backup']);
  assert.equal(suggestion.excluded.length, 1);
  assert.equal(suggestion.excluded[0].display_name, 'Old');
});

test('allows error providers but ranks unhealthy providers later within the same tag', () => {
  const suggestion = buildTagBasedFallbackSuggestion([
    provider({ id: 'bad', display_name: 'Bad Primary', status: 'error', quota_state: { health: 'error' }, metadata: { tags: ['primary'] } }),
    provider({ id: 'good', display_name: 'Good Primary', quota_state: { health: 'healthy' }, metadata: { tags: ['primary'] } })
  ]);

  assert.deepEqual(suggestion.steps.map((step) => step.provider_connection_id), ['good', 'bad']);
  assert.equal(suggestion.steps[1].status, 'error');
});

test('uses highest priority tag when provider has multiple tags', () => {
  const suggestion = buildTagBasedFallbackSuggestion([
    provider({ id: 'backup', metadata: { tags: ['backup'] } }),
    provider({ id: 'multi', metadata: { tags: ['backup', 'primary', 'cheap'] } })
  ]);

  assert.deepEqual(suggestion.steps.map((step) => step.provider_connection_id), ['multi', 'backup']);
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
node --test apps/web/lib/provider-routing-suggestions.test.js
```

Expected: FAIL because helper file/export does not exist.

**Step 3: Implement helper**

Create `apps/web/lib/provider-routing-suggestions.js`:

```js
import { normalizeProviderTags, providerTagLabel } from './provider-tags.js';

const tagPriority = ['primary', 'cheap', 'free', 'backup'];
const healthPriority = new Map([
  ['ok', 0],
  ['healthy', 0],
  ['unknown', 1],
  ['error', 2]
]);

function providerHealth(provider) {
  return provider?.quota_state?.health || 'unknown';
}

function providerDisplayName(provider) {
  return provider?.display_name || 'Unnamed provider';
}

function tagRank(provider) {
  const tags = normalizeProviderTags(provider?.metadata?.tags);
  const ranks = tags.map((tag) => tagPriority.indexOf(tag)).filter((rank) => rank >= 0);
  return ranks.length > 0 ? Math.min(...ranks) : tagPriority.length;
}

function primaryTag(provider) {
  const tags = normalizeProviderTags(provider?.metadata?.tags);
  return tagPriority.find((tag) => tags.includes(tag)) || null;
}

function healthRank(provider) {
  return healthPriority.get(providerHealth(provider)) ?? 1;
}

function compareProviders(left, right) {
  const rankDelta = tagRank(left) - tagRank(right);
  if (rankDelta !== 0) return rankDelta;

  const healthDelta = healthRank(left) - healthRank(right);
  if (healthDelta !== 0) return healthDelta;

  const nameDelta = providerDisplayName(left).localeCompare(providerDisplayName(right));
  if (nameDelta !== 0) return nameDelta;

  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function buildTagBasedFallbackSuggestion(providers) {
  const rows = Array.isArray(providers) ? providers : [];
  const excluded = [];
  const eligible = [];

  for (const provider of rows) {
    if (provider?.status === 'disconnected') {
      excluded.push({
        id: provider?.id || null,
        display_name: providerDisplayName(provider),
        reason: 'Disconnected providers cannot be added to the default fallback chain.'
      });
      continue;
    }

    if (provider?.status === 'active' || provider?.status === 'error') {
      eligible.push(provider);
    }
  }

  const steps = [...eligible].sort(compareProviders).map((provider) => ({
    provider_connection_id: provider.id,
    display_name: providerDisplayName(provider),
    status: provider.status,
    health: providerHealth(provider),
    model_alias: '',
    suggestion_tag: primaryTag(provider),
    suggestion_label: primaryTag(provider) ? providerTagLabel(primaryTag(provider)) : 'No tag'
  }));

  return {
    steps,
    reasons: [
      'Primary providers are tried first.',
      'Cheap/free providers are preferred before backup providers.',
      'Disconnected providers are excluded.'
    ],
    excluded
  };
}
```

**Step 4: Verify tests pass**

Run:

```bash
node --test apps/web/lib/provider-routing-suggestions.test.js
npm run lint:web
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/lib/provider-routing-suggestions.js apps/web/lib/provider-routing-suggestions.test.js
git commit -m "feat: add tag based routing suggestion helper"
```

---

### Task 2: Add suggestion panel to fallback-chain editor

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Import helper**

Add:

```js
import { buildTagBasedFallbackSuggestion } from '../../lib/provider-routing-suggestions.js';
```

**Step 2: Compute suggestion**

Inside `DashboardClient`, after provider-related helpers are available, add:

```js
const tagBasedSuggestion = useMemo(() => buildTagBasedFallbackSuggestion(providers), [providers]);
```

Keep this near other derived state.

**Step 3: Add apply handler**

Add a function:

```js
function applyTagBasedSuggestion() {
  setPresetDraftSteps(tagBasedSuggestion.steps.map((step) => ({
    provider_connection_id: step.provider_connection_id,
    display_name: step.display_name,
    status: step.status,
    health: step.health,
    model_alias: ''
  })));
  setPresetStatus({ type: 'success', message: 'Suggested chain applied to draft. Review it, then Save chain.' });
}
```

**Step 4: Add render component/helper**

Add a small component above `DashboardClient` or inline section markup:

```jsx
function TagBasedSuggestionPanel({ suggestion, onApply }) {
  const steps = Array.isArray(suggestion?.steps) ? suggestion.steps : [];
  const excluded = Array.isArray(suggestion?.excluded) ? suggestion.excluded : [];

  return (
    <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
      <div>
        <strong>Tag-based suggestion</strong>
        <p style={{ margin: '4px 0 0', color: '#1e40af' }}>Primary providers first, then cheap/free, then backup. Applying this only changes the local draft.</p>
      </div>
      {steps.length === 0 ? <p style={{ margin: 0, color: '#4b5563' }}>No eligible providers for a tag-based suggestion yet.</p> : null}
      {steps.length > 0 ? (
        <ol style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 6 }}>
          {steps.map((step) => (
            <li key={step.provider_connection_id}>
              <strong>{step.display_name}</strong> — {step.suggestion_label} · {step.health || 'unknown'}{step.status === 'error' ? ' · status error' : ''}
            </li>
          ))}
        </ol>
      ) : null}
      {excluded.length > 0 ? (
        <details>
          <summary>Excluded providers</summary>
          <ul style={{ marginBottom: 0 }}>
            {excluded.map((provider) => (
              <li key={provider.id || provider.display_name}>{provider.display_name} — {provider.reason}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <button style={buttonStyle} type="button" onClick={onApply} disabled={steps.length === 0}>Apply suggestion to draft</button>
    </div>
  );
}
```

**Step 5: Render in Default fallback chain**

Inside `<section id="default-fallback-chain">`, after the header and before status/loading/draft list, render:

```jsx
<TagBasedSuggestionPanel suggestion={tagBasedSuggestion} onApply={applyTagBasedSuggestion} />
```

**Step 6: Verify**

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS. Build should still include `/dashboard`.

**Step 7: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: show tag based fallback suggestions"
```

---

### Task 3: Update docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/SETUP.md`

**Step 1: README**

Add current feature bullet:

```md
- Dashboard can suggest a default fallback-chain draft from provider routing hint tags
```

Remove `Add tag-based routing policy suggestions` from Next Build Steps if present.

**Step 2: API contract**

In the provider tags section, update the note from tags being visual hints only to:

```md
Tags do not directly change router behavior. The dashboard can use them to suggest a default fallback-chain draft, but routing changes only after the user saves the default chain.
```

In the default preset section, add:

```md
The dashboard may build a local draft suggestion from provider tags (`primary`, `cheap`, `free`, `backup`). This suggestion is not persisted until `PUT /api/presets/default` is called.
```

Use `rg -n "default preset|/api/presets/default|routing hint" docs/API_CONTRACT.md` to locate the exact insertion points.

**Step 3: Backlog**

Mark tag-based routing policy suggestions as implemented in P1 notes.

**Step 4: Setup**

Add manual verification step:

```md
Use provider tags in `/dashboard`, apply the tag-based fallback-chain suggestion to the draft, then click `Save chain` to persist the order.
```

**Step 5: Verify and commit**

```bash
npm run lint:web
npm run build:web
git add README.md docs/API_CONTRACT.md docs/BACKLOG.md docs/SETUP.md
git commit -m "docs: document tag based routing suggestions"
```

---

### Task 4: Final verification

Run:

```bash
node --test apps/web/lib/provider-routing-suggestions.test.js
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- helper tests pass
- lint passes
- build passes
- Go tests pass

Inspect:

```bash
git status --short
git log --oneline -8
```

Expected: clean except local untracked `.pi/` if present.

Report commits and verification results.
