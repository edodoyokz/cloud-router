# Onboarding Wizard Persisted Checklist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a persisted Quick start onboarding wizard in `/dashboard` that guides workspaces through provider setup, health check, router key generation, snippet copy, and first request.

**Architecture:** Add a workspace-scoped onboarding helper and `/api/onboarding` route. Derived checklist steps come from existing providers, API keys, and usage events; explicit state such as snippet copy and dismiss is stored in `workspaces.metadata.onboarding`. Dashboard renders a non-blocking Quick start card and uses existing dashboard sections as CTAs.

**Tech Stack:** Next.js App Router, React client component, Supabase REST admin helper, existing workspace/auth helpers, PostgreSQL JSONB metadata, Go router unchanged.

---

## Pre-flight

Run from repo root:

```bash
git status --short
npm run lint:web
cd services/router && go test ./...
```

Expected baseline: lint and Go tests pass. Existing untracked `.pi/` may remain.

---

### Task 1: Add onboarding helper module

**Files:**
- Create: `apps/web/lib/onboarding.js`

**Step 1: Create helper module**

Add:

```js
export const ONBOARDING_STEPS = [
  {
    id: 'connect_provider',
    label: 'Connect a provider',
    description: 'Add an OpenAI-compatible API-key provider.',
    source: 'derived'
  },
  {
    id: 'check_provider_health',
    label: 'Run a provider health check',
    description: 'Verify NusaNexus Router can reach at least one provider.',
    source: 'derived'
  },
  {
    id: 'generate_router_key',
    label: 'Generate a router API key',
    description: 'Create a key for Claude Code, Codex, OpenClaw, Cursor, or cURL.',
    source: 'derived'
  },
  {
    id: 'copy_client_snippet',
    label: 'Copy a client snippet',
    description: 'Copy a ready-to-use setup snippet from Endpoint config.',
    source: 'persisted'
  },
  {
    id: 'send_first_request',
    label: 'Send your first request',
    description: 'Make one successful request through the hosted router.',
    source: 'derived'
  }
];

export const PERSISTED_ONBOARDING_STEP_IDS = ['copy_client_snippet'];

export function normalizeOnboardingState(value) {
  const state = value && typeof value === 'object' ? value : {};
  const completedSteps = Array.isArray(state.completed_steps) ? state.completed_steps : [];
  return {
    dismissed: Boolean(state.dismissed),
    completed_steps: completedSteps.filter((step) => PERSISTED_ONBOARDING_STEP_IDS.includes(step)),
    updated_at: typeof state.updated_at === 'string' ? state.updated_at : null
  };
}

export function validatePersistedOnboardingSteps(steps) {
  if (!Array.isArray(steps)) {
    throw Object.assign(new Error('completed_steps must be an array'), { status: 400, code: 'validation_error' });
  }
  const unknown = steps.filter((step) => !PERSISTED_ONBOARDING_STEP_IDS.includes(step));
  if (unknown.length > 0) {
    throw Object.assign(new Error(`unknown onboarding step: ${unknown[0]}`), { status: 400, code: 'validation_error' });
  }
  return Array.from(new Set(steps));
}

export function buildOnboardingChecklist({ onboardingState, hasProvider, hasHealthyProvider, hasApiKey, hasUsageEvent }) {
  const state = normalizeOnboardingState(onboardingState);
  const derivedCompletion = {
    connect_provider: Boolean(hasProvider),
    check_provider_health: Boolean(hasHealthyProvider),
    generate_router_key: Boolean(hasApiKey),
    send_first_request: Boolean(hasUsageEvent)
  };
  const persisted = new Set(state.completed_steps);
  const steps = ONBOARDING_STEPS.map((step) => {
    const complete = step.source === 'persisted' ? persisted.has(step.id) : Boolean(derivedCompletion[step.id]);
    return { ...step, complete };
  });
  return {
    dismissed: state.dismissed,
    steps,
    completed_count: steps.filter((step) => step.complete).length,
    total_count: steps.length
  };
}

export function mergeOnboardingMetadata(metadata, onboardingPatch) {
  return {
    ...(metadata || {}),
    onboarding: {
      ...normalizeOnboardingState(metadata?.onboarding),
      ...onboardingPatch,
      updated_at: new Date().toISOString()
    }
  };
}
```

**Step 2: Commit**

```bash
git add apps/web/lib/onboarding.js
git commit -m "feat: add onboarding checklist helpers"
```

---

### Task 2: Add workspace metadata schema/docs support

**Files:**
- Modify: `docs/schema.sql`
- Modify: `docs/DB_SCHEMA.md`

**Step 1: Update schema**

Add `metadata jsonb not null default '{}'::jsonb` to `workspaces` table after `slug`.

Also add an idempotent migration line after table creation:

```sql
alter table workspaces add column if not exists metadata jsonb not null default '{}'::jsonb;
```

**Step 2: Update DB docs**

Add `metadata` to the `workspaces` table description and mention `metadata.onboarding` stores Quick start state.

**Step 3: Commit**

```bash
git add docs/schema.sql docs/DB_SCHEMA.md
git commit -m "docs: add workspace onboarding metadata schema"
```

---

### Task 3: Add `/api/onboarding` route

**Files:**
- Create: `apps/web/app/api/onboarding/route.js`

**Step 1: Implement GET and PATCH**

Use existing helpers:

```js
import { NextResponse } from 'next/server';
import {
  buildOnboardingChecklist,
  mergeOnboardingMetadata,
  normalizeOnboardingState,
  validatePersistedOnboardingSteps
} from '../../../lib/onboarding.js';
import { supabasePatch, supabaseSelect } from '../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../lib/workspace.js';
```

GET flow:

1. Resolve workspace ID.
2. Select workspace `id,metadata`.
3. Select active/non-disconnected providers for workspace.
4. Select active/non-revoked API keys for workspace.
5. Select one usage event for workspace.
6. Return `buildOnboardingChecklist`.

Suggested queries:

```js
const workspaceRows = await supabaseSelect('workspaces', `?id=eq.${encodeURIComponent(workspaceId)}&select=id,metadata&limit=1`);
const providers = await supabaseSelect('provider_connections', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=neq.disconnected&select=id,quota_state&limit=50`);
const apiKeys = await supabaseSelect('api_keys', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&revoked_at=is.null&select=id&limit=1`);
const usageEvents = await supabaseSelect('usage_events', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id&limit=1`);
```

Compute:

```js
const checklist = buildOnboardingChecklist({
  onboardingState: workspace.metadata?.onboarding,
  hasProvider: providers.length > 0,
  hasHealthyProvider: providers.some((provider) => provider.quota_state?.health === 'healthy'),
  hasApiKey: apiKeys.length > 0,
  hasUsageEvent: usageEvents.length > 0
});
```

PATCH flow:

1. Resolve workspace ID.
2. Load workspace metadata.
3. Parse body.
4. If `completed_steps` exists, validate with `validatePersistedOnboardingSteps`.
5. If `dismissed` exists, coerce to boolean.
6. Patch `workspaces.metadata` using `mergeOnboardingMetadata`.
7. Return same checklist shape as GET using updated metadata and derived state.

Use consistent error shape:

```js
return NextResponse.json({ error: { code, message: error.message } }, { status });
```

**Step 2: Verify build route appears**

```bash
npm run build:web
```

Expected route includes:

```text
/api/onboarding
```

**Step 3: Commit**

```bash
git add apps/web/app/api/onboarding/route.js
git commit -m "feat: add onboarding progress api"
```

---

### Task 4: Add Quick start dashboard card

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add onboarding state**

Add state:

```js
const [onboarding, setOnboarding] = useState(null);
const [loadingOnboarding, setLoadingOnboarding] = useState(false);
const [onboardingStatus, setOnboardingStatus] = useState(null);
```

Add `loadOnboarding` with authenticated headers. Call it from initial `useEffect`, and after actions that can affect derived state:

- provider connect
- provider health check
- key generation
- resource reload if simple

**Step 2: Add section anchors**

Add `id` attributes to existing sections:

- `connected-providers`
- `default-fallback-chain`
- `connect-provider`
- `generate-router-key`
- `endpoint-config`
- `usage-dashboard`

**Step 3: Add QuickStart component in same file**

Render near top, after workspace card:

- progress `completed_count / total_count`
- progress bar
- rows with complete status
- CTA buttons calling `document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })`
- Dismiss / Show quick start button using PATCH `/api/onboarding`

CTA mapping:

```js
const onboardingTargets = {
  connect_provider: 'connect-provider',
  check_provider_health: 'connected-providers',
  generate_router_key: 'generate-router-key',
  copy_client_snippet: 'endpoint-config',
  send_first_request: 'endpoint-config'
};
```

**Step 4: Add snippet copy progress**

For each Endpoint config snippet, add a `Copy` button:

```js
await navigator.clipboard.writeText(snippet.content);
await updateOnboarding({ completed_steps: ['copy_client_snippet'] });
```

If clipboard succeeds but PATCH fails, show a warning but do not block copied content.

**Step 5: Commit**

```bash
npm run lint:web
npm run build:web
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: add onboarding quick start dashboard"
```

---

### Task 5: Update product docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: README**

Add current thin slice bullet:

```md
- Dashboard shows a persisted Quick start onboarding checklist
```

Remove or replace next build step for better onboarding wizard.

**Step 2: API contract**

Document:

```text
GET /api/onboarding
PATCH /api/onboarding
```

Include request/response examples and note that only `copy_client_snippet` is client-persisted.

**Step 3: Setup**

Add manual verification step for Quick start checklist.

**Step 4: Backlog**

Mark Better onboarding wizard as done and add note.

**Step 5: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document onboarding wizard"
```

---

### Task 6: Final verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint passes
- Next build passes and includes `/api/onboarding`
- Go tests pass

Then check:

```bash
git status --short
git log --oneline -8
```

Expected: clean except local untracked `.pi/` if present.

Commit any missed docs or fixes before reporting completion.
