# Pricing / Cost Estimation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add workspace-level manual pricing rules and compute estimated usage cost from stored prompt/completion token counts.

**Architecture:** Add `model_pricing_rules` schema/docs, pure JS pricing helper functions, pricing rules API routes, update Usage API to enrich events/summary with estimated cost, and add dashboard UI for pricing rule management.

**Tech Stack:** Next.js 16 App Router, React 19 dashboard client, Supabase PostgREST admin helper, existing workspace/auth resolver.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-pricing-cost-estimation-design.md
```

Relevant files:

```text
docs/schema.sql
docs/DB_SCHEMA.md
apps/web/lib/usage-summary.js
apps/web/app/api/usage/route.js
apps/web/lib/supabase-admin.js
apps/web/app/api/providers/route.js
apps/web/app/dashboard/dashboard-client.jsx
README.md
docs/API_CONTRACT.md
docs/SETUP.md
docs/BACKLOG.md
```

Current behavior:

- Router records `prompt_tokens`, `completion_tokens`, and `total_tokens` on successful provider responses.
- `GET /api/usage` returns token breakdown.
- `summarizeUsageEvents()` returns `estimated_cost_usd: 0` placeholder.
- Dashboard renders usage summary and recent events.
- Dashboard already loads providers via `loadResources()`.

Constraints:

- Cost estimation only; no billing.
- No router changes expected.
- No prompt/completion body storage.
- Manual pricing config only; no hardcoded provider catalog.
- Exact model match only for MVP.
- Provider-specific rule beats workspace-wide rule.

---

## Task 1: Add pricing schema/docs

**Files:**
- Modify: `docs/schema.sql`
- Modify: `docs/DB_SCHEMA.md`

### Step 1: Update `docs/schema.sql`

Add after `usage_events` index or before `request_logs`:

```sql
-- model pricing rules
create table if not exists model_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider_connection_id uuid references provider_connections(id) on delete cascade,
  model_pattern text not null,
  input_usd_per_1m_tokens numeric not null default 0,
  output_usd_per_1m_tokens numeric not null default 0,
  currency text not null default 'USD',
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_model_pricing_rules_workspace_status
  on model_pricing_rules (workspace_id, status);

create index if not exists idx_model_pricing_rules_workspace_provider_model
  on model_pricing_rules (workspace_id, provider_connection_id, model_pattern);
```

Add trigger near other triggers:

```sql
drop trigger if exists trg_model_pricing_rules_updated_at on model_pricing_rules;
create trigger trg_model_pricing_rules_updated_at
before update on model_pricing_rules
for each row execute function set_updated_at();
```

### Step 2: Update `docs/DB_SCHEMA.md`

Add a new table section after `usage_events`:

```md
### 9. model_pricing_rules
Manual workspace pricing rules used for cost estimation.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | owner workspace |
| provider_connection_id | uuid FK provider_connections.id nullable | optional provider-specific rule; null means workspace-wide |
| model_pattern | text | exact model match for MVP |
| input_usd_per_1m_tokens | numeric | prompt/input price per 1M tokens |
| output_usd_per_1m_tokens | numeric | completion/output price per 1M tokens |
| currency | text | USD for MVP |
| status | text | active, disabled |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |
```

Renumber later sections if needed, or call this `### 8b. model_pricing_rules` to avoid large renumbering.

Add indexes:

```md
- `model_pricing_rules(workspace_id, status)`
- `model_pricing_rules(workspace_id, provider_connection_id, model_pattern)`
```

Add future table note removal if it mentions pricing table later.

### Step 3: Commit

```bash
git add docs/schema.sql docs/DB_SCHEMA.md
git commit -m "docs: add pricing rules schema"
```

---

## Task 2: Add pricing helper functions

**Files:**
- Create: `apps/web/lib/pricing.js`

### Step 1: Create helper

Create file:

```js
export function normalizePricingRuleInput(input) {
  const provider_connection_id = normalizeOptionalId(input?.provider_connection_id);
  const model_pattern = String(input?.model_pattern || '').trim();
  const input_usd_per_1m_tokens = normalizePrice(input?.input_usd_per_1m_tokens, 'input_usd_per_1m_tokens');
  const output_usd_per_1m_tokens = normalizePrice(input?.output_usd_per_1m_tokens, 'output_usd_per_1m_tokens');

  if (!model_pattern) {
    throw Object.assign(new Error('model_pattern is required'), { status: 400, code: 'validation_error' });
  }

  return {
    provider_connection_id,
    model_pattern,
    input_usd_per_1m_tokens,
    output_usd_per_1m_tokens
  };
}

export function enrichUsageEventsWithPricing(events, rules) {
  const safeEvents = Array.isArray(events) ? events : [];
  return safeEvents.map((event) => {
    const rule = findPricingRuleForEvent(event, rules);
    const estimatedCost = rule ? calculateEstimatedCost(event, rule) : 0;
    return {
      ...event,
      estimated_cost_usd: estimatedCost,
      pricing_rule_missing: !rule
    };
  });
}

export function calculateEstimatedCost(event, rule) {
  const promptTokens = Number(event?.prompt_tokens || 0);
  const completionTokens = Number(event?.completion_tokens || 0);
  const inputPrice = Number(rule?.input_usd_per_1m_tokens || 0);
  const outputPrice = Number(rule?.output_usd_per_1m_tokens || 0);
  return (promptTokens / 1_000_000 * inputPrice) + (completionTokens / 1_000_000 * outputPrice);
}

export function findPricingRuleForEvent(event, rules) {
  const model = String(event?.model_resolved || '').trim();
  if (!model) return null;
  const safeRules = Array.isArray(rules) ? rules : [];
  const activeMatches = safeRules.filter((rule) =>
    rule?.status === 'active' && String(rule?.model_pattern || '').trim() === model
  );
  const providerId = event?.provider_connection_id;
  const providerMatch = activeMatches.find((rule) => rule.provider_connection_id && rule.provider_connection_id === providerId);
  if (providerMatch) return providerMatch;
  return activeMatches.find((rule) => !rule.provider_connection_id) || null;
}

function normalizeOptionalId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizePrice(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw Object.assign(new Error(`${field} must be a non-negative number`), { status: 400, code: 'validation_error' });
  }
  return parsed;
}
```

### Step 2: Update usage summary helper

Modify `apps/web/lib/usage-summary.js`:

Change:

```js
const totalTokens = safeEvents.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
```

Add after it:

```js
const estimatedCostUsd = safeEvents.reduce((sum, event) => sum + Number(event.estimated_cost_usd || 0), 0);
```

Change summary return:

```js
estimated_cost_usd: estimatedCostUsd
```

instead of `0`.

### Step 3: Optional quick node check

```bash
node --input-type=module - <<'NODE'
import { calculateEstimatedCost, enrichUsageEventsWithPricing } from './apps/web/lib/pricing.js';
console.log(calculateEstimatedCost({ prompt_tokens: 1000, completion_tokens: 500 }, { input_usd_per_1m_tokens: 1, output_usd_per_1m_tokens: 2 }));
console.log(enrichUsageEventsWithPricing([{ provider_connection_id: 'p1', model_resolved: 'm', prompt_tokens: 1000, completion_tokens: 500 }], [{ status: 'active', provider_connection_id: null, model_pattern: 'm', input_usd_per_1m_tokens: 1, output_usd_per_1m_tokens: 2 }]));
NODE
```

Expected first output: `0.002`.

ESM package warning is acceptable if lint/build pass.

### Step 4: Lint/build

```bash
npm run lint:web
npm run build:web
```

### Step 5: Commit

```bash
git add apps/web/lib/pricing.js apps/web/lib/usage-summary.js
git commit -m "feat: add pricing estimation helpers"
```

---

## Task 3: Add pricing rules API routes

**Files:**
- Create: `apps/web/app/api/pricing/rules/route.js`
- Create: `apps/web/app/api/pricing/rules/[id]/route.js`

### Step 1: Create route directory/files

```bash
mkdir -p apps/web/app/api/pricing/rules/[id]
```

### Step 2: Implement collection route

`apps/web/app/api/pricing/rules/route.js`:

```js
import { NextResponse } from 'next/server';
import { normalizePricingRuleInput } from '../../../../lib/pricing.js';
import { supabaseInsert, supabaseSelect } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const rules = await supabaseSelect(
      'model_pricing_rules',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.active&select=id,provider_connection_id,model_pattern,input_usd_per_1m_tokens,output_usd_per_1m_tokens,currency,status,created_at&order=created_at.desc`
    );
    return NextResponse.json(rules);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function POST(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const input = normalizePricingRuleInput(await request.json());

    if (input.provider_connection_id) {
      const providers = await supabaseSelect(
        'provider_connections',
        `?id=eq.${encodeURIComponent(input.provider_connection_id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id&limit=1`
      );
      if (providers.length === 0) {
        throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
      }
    }

    const [rule] = await supabaseInsert('model_pricing_rules', [{
      workspace_id: workspaceId,
      provider_connection_id: input.provider_connection_id,
      model_pattern: input.model_pattern,
      input_usd_per_1m_tokens: input.input_usd_per_1m_tokens,
      output_usd_per_1m_tokens: input.output_usd_per_1m_tokens,
      currency: 'USD',
      status: 'active'
    }]);

    return NextResponse.json({
      id: rule.id,
      provider_connection_id: rule.provider_connection_id,
      model_pattern: rule.model_pattern,
      input_usd_per_1m_tokens: rule.input_usd_per_1m_tokens,
      output_usd_per_1m_tokens: rule.output_usd_per_1m_tokens,
      currency: rule.currency,
      status: rule.status,
      created_at: rule.created_at
    }, { status: 201 });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

### Step 3: Implement item route

`apps/web/app/api/pricing/rules/[id]/route.js`:

```js
import { NextResponse } from 'next/server';
import { supabasePatch } from '../../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../../lib/workspace.js';

export async function DELETE(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('pricing rule id is required'), { status: 400, code: 'validation_error' });

    const rows = await supabasePatch(
      'model_pricing_rules',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { status: 'disabled' }
    );
    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('pricing rule not found'), { status: 404, code: 'not_found' });
    }

    return NextResponse.json({ disabled: true });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

### Step 4: Lint/build

```bash
npm run lint:web
npm run build:web
```

Build should include:

```text
/api/pricing/rules
/api/pricing/rules/[id]
```

### Step 5: Commit

```bash
git add apps/web/app/api/pricing/rules/route.js apps/web/app/api/pricing/rules/[id]/route.js
git commit -m "feat: add pricing rules api"
```

---

## Task 4: Update Usage API with cost estimation

**Files:**
- Modify: `apps/web/app/api/usage/route.js`

### Step 1: Import pricing helper

Add:

```js
import { enrichUsageEventsWithPricing } from '../../../lib/pricing.js';
```

### Step 2: Query pricing rules

After usage event query, add:

```js
const pricingRules = await supabaseSelect(
  'model_pricing_rules',
  `?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.active&select=id,provider_connection_id,model_pattern,input_usd_per_1m_tokens,output_usd_per_1m_tokens,currency,status`
);
const enrichedEvents = enrichUsageEventsWithPricing(events, pricingRules);
```

### Step 3: Return enriched events and summary

Change response:

```js
return NextResponse.json({
  period,
  summary: summarizeUsageEvents(enrichedEvents),
  events: enrichedEvents
});
```

### Step 4: Lint/build

```bash
npm run lint:web
npm run build:web
```

### Step 5: Commit

```bash
git add apps/web/app/api/usage/route.js
git commit -m "feat: estimate usage cost from pricing rules"
```

---

## Task 5: Add dashboard pricing rule management UI

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

### Step 1: Add state

Inside `DashboardClient`, add:

```js
const [pricingRules, setPricingRules] = useState([]);
const [loadingPricingRules, setLoadingPricingRules] = useState(false);
const [pricingPending, setPricingPending] = useState(false);
const [pricingStatus, setPricingStatus] = useState(null);
const [pricingForm, setPricingForm] = useState({
  provider_connection_id: '',
  model_pattern: '',
  input_usd_per_1m_tokens: '',
  output_usd_per_1m_tokens: ''
});
```

### Step 2: Add loader

Use `useCallback` like other loaders:

```js
const loadPricingRules = useCallback(async function loadPricingRules() {
  setLoadingPricingRules(true);
  setPricingStatus(null);
  try {
    const response = await fetch('/api/pricing/rules', {
      headers: await authenticatedJsonHeaders(),
      cache: 'no-store'
    });
    const data = await parseJsonResponse(response, 'Failed to load pricing rules');
    setPricingRules(Array.isArray(data) ? data : []);
  } catch (error) {
    setPricingStatus({ type: 'error', message: error.message || 'Failed to load pricing rules' });
  } finally {
    setLoadingPricingRules(false);
  }
}, []);
```

### Step 3: Call loader on mount/auth session ready

There is already an effect for resources/usage/preset. Add `loadPricingRules()` to the appropriate initial load effect, and add it to dependency list.

### Step 4: Add handlers

```js
function updatePricingField(field, value) {
  setPricingForm((current) => ({ ...current, [field]: value }));
}

async function createPricingRule(event) {
  event.preventDefault();
  setPricingPending(true);
  setPricingStatus(null);
  try {
    const payload = {
      ...pricingForm,
      provider_connection_id: pricingForm.provider_connection_id || null
    };
    const response = await fetch('/api/pricing/rules', {
      method: 'POST',
      headers: await authenticatedJsonHeaders(),
      body: JSON.stringify(payload)
    });
    await parseJsonResponse(response, 'Failed to create pricing rule');
    setPricingForm({ provider_connection_id: '', model_pattern: '', input_usd_per_1m_tokens: '', output_usd_per_1m_tokens: '' });
    setPricingStatus({ type: 'success', message: 'Pricing rule added.' });
    await loadPricingRules();
    await loadUsage(usagePeriod);
  } catch (error) {
    setPricingStatus({ type: 'error', message: error.message || 'Failed to create pricing rule' });
  } finally {
    setPricingPending(false);
  }
}

async function disablePricingRule(ruleId) {
  setPendingActionId(`pricing:${ruleId}`);
  setPricingStatus(null);
  try {
    const response = await fetch(`/api/pricing/rules/${ruleId}`, {
      method: 'DELETE',
      headers: await authenticatedJsonHeaders()
    });
    await parseJsonResponse(response, 'Failed to disable pricing rule');
    setPricingStatus({ type: 'success', message: 'Pricing rule disabled.' });
    await loadPricingRules();
    await loadUsage(usagePeriod);
  } catch (error) {
    setPricingStatus({ type: 'error', message: error.message || 'Failed to disable pricing rule' });
  } finally {
    setPendingActionId(null);
  }
}
```

### Step 5: Render Pricing rules card

Place near Usage section or Providers section:

```jsx
<section style={cardStyle}>
  <div>
    <h2 style={{ margin: 0 }}>Pricing rules</h2>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Estimate cost from prompt/completion tokens. Prices are USD per 1M tokens.</p>
  </div>
  {pricingStatus ? <StatusMessage status={pricingStatus} /> : null}
  <form onSubmit={createPricingRule} style={{ display: 'grid', gap: 14 }}>
    <label style={labelStyle}>
      Provider optional
      <select style={inputStyle} value={pricingForm.provider_connection_id} onChange={(event) => updatePricingField('provider_connection_id', event.target.value)}>
        <option value="">Workspace-wide / any provider</option>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.display_name} — {provider.status}</option>
        ))}
      </select>
    </label>
    <label style={labelStyle}>
      Model pattern exact match
      <input style={inputStyle} value={pricingForm.model_pattern} onChange={(event) => updatePricingField('model_pattern', event.target.value)} placeholder="gpt-4o-mini" />
    </label>
    <label style={labelStyle}>
      Input USD / 1M tokens
      <input style={inputStyle} type="number" min="0" step="0.000001" value={pricingForm.input_usd_per_1m_tokens} onChange={(event) => updatePricingField('input_usd_per_1m_tokens', event.target.value)} />
    </label>
    <label style={labelStyle}>
      Output USD / 1M tokens
      <input style={inputStyle} type="number" min="0" step="0.000001" value={pricingForm.output_usd_per_1m_tokens} onChange={(event) => updatePricingField('output_usd_per_1m_tokens', event.target.value)} />
    </label>
    <button style={buttonStyle} disabled={pricingPending} type="submit">{pricingPending ? 'Adding…' : 'Add pricing rule'}</button>
  </form>

  {loadingPricingRules ? <p>Loading pricing rules…</p> : null}
  {pricingRules.length === 0 && !loadingPricingRules ? <p style={{ color: '#4b5563' }}>No pricing rules yet. Usage cost will show as not configured.</p> : null}
  <div style={{ display: 'grid', gap: 12 }}>
    {pricingRules.map((rule) => (
      <div key={rule.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
        <strong>{rule.model_pattern}</strong>
        <span>Scope: {providerNameForId(providers, rule.provider_connection_id)}</span>
        <span>Input: ${formatPrice(rule.input_usd_per_1m_tokens)} / 1M tokens</span>
        <span>Output: ${formatPrice(rule.output_usd_per_1m_tokens)} / 1M tokens</span>
        <span>Created: {formatDate(rule.created_at)}</span>
        <button style={buttonStyle} disabled={pendingActionId === `pricing:${rule.id}`} onClick={() => disablePricingRule(rule.id)} type="button">
          {pendingActionId === `pricing:${rule.id}` ? 'Disabling…' : 'Disable rule'}
        </button>
      </div>
    ))}
  </div>
</section>
```

### Step 6: Add formatting helpers outside component

```js
function providerNameForId(providers, providerId) {
  if (!providerId) return 'Workspace-wide / any provider';
  const provider = providers.find((item) => item.id === providerId);
  return provider ? provider.display_name : providerId;
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

function formatUsd(value) {
  const amount = Number(value || 0);
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
}
```

### Step 7: Update usage event rendering

In recent event line, add:

```jsx
<span>Cost: {event.pricing_rule_missing ? 'not configured' : formatUsd(event.estimated_cost_usd)}</span>
```

Ensure summary estimated cost card uses `formatUsd`, if currently raw/fixed formatting differs.

### Step 8: Lint/build

```bash
npm run lint:web
npm run build:web
```

Watch for React hook dependency lint. If `loadPricingRules` or `loadUsage` dependencies cause warnings, follow existing project pattern with `useCallback` and dependency arrays.

### Step 9: Commit

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: manage pricing rules in dashboard"
```

---

## Task 6: Update docs/API contract/setup/backlog

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

### README

Add current thin slice bullet:

```md
- Dashboard can configure manual pricing rules and estimate usage cost
```

Update Next Build Steps:

```md
## Next Build Steps
1. Add richer onboarding snippets for Claude Code / Codex / OpenClaw / Cursor
2. Add production SSR/cookie auth hardening
3. Add usage charts and provider breakdowns
4. Add provider tags for primary/backup/free/cheap routing hints
```

### API_CONTRACT

Add pricing routes:

```md
### `GET /api/pricing/rules`
Lists active workspace pricing rules.

### `POST /api/pricing/rules`
Creates a manual pricing rule.

Request:
```json
{
  "provider_connection_id": null,
  "model_pattern": "gpt-4o-mini",
  "input_usd_per_1m_tokens": 0.15,
  "output_usd_per_1m_tokens": 0.6
}
```

### `DELETE /api/pricing/rules/{id}`
Soft-disables a pricing rule.
```

Update Usage API response examples to include:

```json
"estimated_cost_usd": 0.000135,
"pricing_rule_missing": false
```

Replace old placeholder note:

```md
`estimated_cost_usd` is computed from active manual pricing rules. If no rule matches an event, that event returns `estimated_cost_usd: 0` and `pricing_rule_missing: true`.
```

### SETUP

Add schema migration note:

```md
Apply the latest `docs/schema.sql` so `model_pricing_rules` exists.
```

Add dashboard smoke step:

```md
Create a Pricing rules entry for the model shown in recent usage, then refresh Usage and confirm estimated cost is no longer `not configured`.
```

### BACKLOG

Add/mark item under P1:

```md
- [x] Pricing/cost estimation configuration
```

Add note:

```md
- Pricing/cost estimation thin slice is implemented with manual workspace pricing rules.
```

### Commit

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document pricing cost estimation"
```

---

## Task 7: Final verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint PASS
- build PASS
- Go tests PASS

Then check:

```bash
git status --short
git log --oneline --decorate -10
```

Expected status clean except `.pi/` if present.

---

## Manual Smoke Test

With Supabase env configured and latest schema applied:

1. Start app:
   ```bash
   npm run dev:web
   ```
2. Log in and open `/dashboard`.
3. Ensure at least one provider and usage event exist.
4. In Pricing rules, add workspace-wide rule:
   ```text
   model_pattern = model_resolved from recent usage
   input_usd_per_1m_tokens = 1
   output_usd_per_1m_tokens = 2
   ```
5. Refresh Usage.
6. Confirm Estimated cost card is non-zero when token counts are non-zero.
7. Confirm recent event shows `Cost: $...`.
8. Disable rule.
9. Refresh Usage.
10. Confirm event shows `Cost: not configured`.

---

## Deferred Work

Do not implement:

- automatic pricing catalogs
- wildcard/regex matching
- currency conversion
- historical cost freezing in usage_events
- router-side cost writes
- charts or daily buckets
- failed attempt cost accounting

---

## Execution Handoff

Plan saved to:

```text
docs/plans/2026-05-01-pricing-cost-estimation-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-pricing-cost-estimation-implementation.md

Follow the plan exactly, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
