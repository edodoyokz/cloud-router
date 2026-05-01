# Usage Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `GET /api/usage` and a dashboard Usage section showing summary metrics and recent usage events for the active workspace.

**Architecture:** Implement pure usage helper functions for period/limit normalization and summary aggregation. Add a Next.js API route that resolves the workspace, queries Supabase `usage_events`, computes summary, and returns safe usage data. Extend the existing dashboard client with independent usage state, period controls, and recent event rendering.

**Tech Stack:** Next.js 16 App Router, React 19 client component, existing Supabase PostgREST admin helper, existing hybrid workspace resolver, npm workspace scripts, Go router tests.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-usage-dashboard-design.md
```

Relevant files:

```text
apps/web/app/dashboard/dashboard-client.jsx
apps/web/app/api/providers/route.js
apps/web/app/api/endpoint/keys/route.js
apps/web/lib/supabase-admin.js
apps/web/lib/workspace.js
docs/API_CONTRACT.md
README.md
docs/SETUP.md
docs/BACKLOG.md
services/router/internal/store/supabase.go
```

Current behavior:

- Router writes usage events through `store.RecordUsage`.
- Dashboard has provider/API key creation and management.
- No `GET /api/usage` route exists yet.
- No usage section exists in dashboard.

Constraints:

- Do not add charts or external visualization libraries.
- Do not add database migrations.
- Do not expose provider credentials, API key hashes, or raw keys.
- Keep usage errors scoped to the usage section.

---

## Task 1: Add usage summary helper

**Files:**
- Create: `apps/web/lib/usage-summary.js`

**Step 1: Create helper file**

Create `apps/web/lib/usage-summary.js`:

```js
const allowedPeriods = new Set(['today', '7d', '30d']);

export function normalizeUsagePeriod(period) {
  const value = String(period || 'today').trim();
  if (!allowedPeriods.has(value)) {
    throw Object.assign(new Error('invalid usage period'), { status: 400, code: 'validation_error' });
  }
  return value;
}

export function usageSinceISOString(period, now = new Date()) {
  const normalized = normalizeUsagePeriod(period);
  const since = new Date(now);

  if (normalized === 'today') {
    since.setUTCHours(0, 0, 0, 0);
    return since.toISOString();
  }

  const days = normalized === '7d' ? 7 : 30;
  since.setUTCDate(since.getUTCDate() - days);
  return since.toISOString();
}

export function clampUsageLimit(limit) {
  const parsed = Number.parseInt(String(limit || '50'), 10);
  if (Number.isNaN(parsed)) return 50;
  return Math.min(100, Math.max(1, parsed));
}

export function summarizeUsageEvents(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const totalRequests = safeEvents.length;
  const totalTokens = safeEvents.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
  const failedCount = safeEvents.filter((event) => event.status === 'failed').length;
  const fallbackCount = safeEvents.filter((event) => event.status === 'fallback').length;
  const successRate = totalRequests === 0 ? 0 : (totalRequests - failedCount) / totalRequests;

  return {
    total_requests: totalRequests,
    total_tokens: totalTokens,
    success_rate: successRate,
    fallback_count: fallbackCount,
    failed_count: failedCount,
    estimated_cost_usd: 0
  };
}
```

**Step 2: Verify helper manually**

Run:

```bash
node -e "import('./apps/web/lib/usage-summary.js').then(m => { console.log(m.normalizeUsagePeriod('7d')); console.log(m.clampUsageLimit('500')); console.log(JSON.stringify(m.summarizeUsageEvents([{status:'success',total_tokens:3},{status:'failed',total_tokens:2}]))); })"
```

Expected output includes:

```text
7d
100
{"total_requests":2,"total_tokens":5,"success_rate":0.5,"fallback_count":0,"failed_count":1,"estimated_cost_usd":0}
```

Node may print a module-type warning. That is acceptable if lint/build pass.

**Step 3: Commit**

```bash
git add apps/web/lib/usage-summary.js
git commit -m "feat: add usage summary helpers"
```

---

## Task 2: Add usage API route

**Files:**
- Create: `apps/web/app/api/usage/route.js`

**Step 1: Create route file**

Create `apps/web/app/api/usage/route.js`:

```js
import { NextResponse } from 'next/server';
import { supabaseSelect } from '../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../lib/workspace.js';
import { clampUsageLimit, normalizeUsagePeriod, summarizeUsageEvents, usageSinceISOString } from '../../../lib/usage-summary.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { searchParams } = new URL(request.url);
    const period = normalizeUsagePeriod(searchParams.get('period'));
    const limit = clampUsageLimit(searchParams.get('limit'));
    const since = usageSinceISOString(period);

    const events = await supabaseSelect(
      'usage_events',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(since)}&select=id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,total_tokens,status,error_code,created_at&order=created_at.desc&limit=${limit}`
    );

    return NextResponse.json({
      period,
      summary: summarizeUsageEvents(events),
      events
    });
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
/api/usage
```

**Step 3: Run lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/app/api/usage/route.js
git commit -m "feat: add usage summary api"
```

---

## Task 3: Add dashboard usage data loading

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add usage state**

Inside `DashboardClient`, add state near other state declarations:

```js
const [usagePeriod, setUsagePeriod] = useState('today');
const [usage, setUsage] = useState(null);
const [usageStatus, setUsageStatus] = useState(null);
const [loadingUsage, setLoadingUsage] = useState(false);
```

**Step 2: Add usage loader callback**

Inside `DashboardClient`, add:

```js
const loadUsage = useCallback(async function loadUsage(period = usagePeriod) {
  setLoadingUsage(true);
  setUsageStatus(null);
  try {
    const response = await fetch(`/api/usage?period=${encodeURIComponent(period)}&limit=50`, {
      headers: await authenticatedJsonHeaders()
    });
    const data = await parseJsonResponse(response, 'Failed to load usage');
    setUsage(data);
  } catch (error) {
    setUsageStatus({ type: 'error', message: error.message || 'Failed to load usage' });
  } finally {
    setLoadingUsage(false);
  }
}, [authenticatedJsonHeaders, usagePeriod]);
```

**Step 3: Load usage on mount/period change without triggering lint**

React lint may reject synchronous setState inside effects. Avoid calling `loadUsage()` directly from `useEffect` if it synchronously sets state before an await.

Preferred implementation:

```js
useEffect(() => {
  let cancelled = false;

  async function loadInitialUsage() {
    try {
      const headers = await authenticatedJsonHeaders();
      if (cancelled) return;
      setLoadingUsage(true);
      setUsageStatus(null);

      const response = await fetch(`/api/usage?period=${encodeURIComponent(usagePeriod)}&limit=50`, { headers });
      const data = await parseJsonResponse(response, 'Failed to load usage');
      if (cancelled) return;
      setUsage(data);
    } catch (error) {
      if (!cancelled) setUsageStatus({ type: 'error', message: error.message || 'Failed to load usage' });
    } finally {
      if (!cancelled) setLoadingUsage(false);
    }
  }

  loadInitialUsage();

  return () => {
    cancelled = true;
  };
}, [authenticatedJsonHeaders, usagePeriod]);
```

This mirrors the previous fix for provider/key resource loading.

**Step 4: Add period change helper**

Inside component:

```js
function selectUsagePeriod(period) {
  setUsagePeriod(period);
}
```

**Step 5: Run lint**

```bash
npm run lint:web
```

Expected: PASS. If lint flags unused `loadUsage`, either use it in a refresh button in the next task or add the refresh button now.

**Step 6: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: load dashboard usage data"
```

---

## Task 4: Render dashboard usage section

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add format helpers outside component**

If not already present, add below `parseJsonResponse`:

```js
function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}
```

There may already be a `formatDate` helper from the management UI slice. Reuse it if present.

**Step 2: Add usage section JSX**

Add a new `<section style={cardStyle}>` near the top of the dashboard after authenticated mode and before provider management:

```jsx
<section style={cardStyle}>
  <div>
    <h2 style={{ margin: 0 }}>Usage</h2>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Workspace usage from router requests.</p>
  </div>

  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {[
      ['today', 'Today'],
      ['7d', '7 days'],
      ['30d', '30 days']
    ].map(([period, label]) => (
      <button
        key={period}
        type="button"
        onClick={() => selectUsagePeriod(period)}
        style={{
          ...buttonStyle,
          background: usagePeriod === period ? '#111827' : '#e5e7eb',
          color: usagePeriod === period ? '#fff' : '#111827'
        }}
      >
        {label}
      </button>
    ))}
    <button type="button" style={buttonStyle} onClick={() => loadUsage()} disabled={loadingUsage}>
      {loadingUsage ? 'Refreshing…' : 'Refresh usage'}
    </button>
  </div>

  {usageStatus ? <StatusMessage status={usageStatus} /> : null}

  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
    <StatCard label="Requests" value={formatNumber(usage?.summary?.total_requests)} />
    <StatCard label="Tokens" value={formatNumber(usage?.summary?.total_tokens)} />
    <StatCard label="Success rate" value={formatPercent(usage?.summary?.success_rate)} />
    <StatCard label="Fallbacks" value={formatNumber(usage?.summary?.fallback_count)} />
    <StatCard label="Failures" value={formatNumber(usage?.summary?.failed_count)} />
  </div>

  <div>
    <h3>Recent events</h3>
    {loadingUsage ? <p>Loading usage…</p> : null}
    {!loadingUsage && (!usage?.events || usage.events.length === 0) ? <p style={{ color: '#4b5563' }}>No usage events for this period yet.</p> : null}
    <div style={{ display: 'grid', gap: 12 }}>
      {(usage?.events || []).map((event) => (
        <div key={event.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 6 }}>
          <strong>{event.status}</strong>
          <span>Requested: {event.model_requested || '—'}</span>
          <span>Resolved: {event.model_resolved || '—'}</span>
          <span>Tokens: {formatNumber(event.total_tokens)}</span>
          <span>Error: {event.error_code || '—'}</span>
          <span>Created: {formatDate(event.created_at)}</span>
        </div>
      ))}
    </div>
  </div>
</section>
```

**Step 3: Add StatCard component outside DashboardClient**

Add near `StatusMessage`:

```jsx
function StatCard({ label, value }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#f8fafc' }}>
      <div style={{ color: '#6b7280', fontSize: 13 }}>{label}</div>
      <strong style={{ fontSize: 22 }}>{value}</strong>
    </div>
  );
}
```

**Step 4: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

If lint flags `loadUsage` setState-in-effect, ensure only local async effect code is used for effect loading and `loadUsage` is used only from button/action handlers.

**Step 5: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: render usage dashboard section"
```

---

## Task 5: Update docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: Update README current thin slice**

Add:

```md
- Dashboard displays usage summary and recent router events
```

Update next build steps:

```md
## Next Build Steps
1. Add provider health checks
2. Add preset editor UI
3. Add production cookie/SSR auth polish and workspace switching
4. Add token/cost accounting improvements
```

**Step 2: Update API contract**

Ensure `GET /api/usage` matches the implemented response:

```json
{
  "period": "7d",
  "summary": {
    "total_requests": 12,
    "total_tokens": 3842,
    "success_rate": 0.92,
    "fallback_count": 1,
    "failed_count": 1,
    "estimated_cost_usd": 0
  },
  "events": []
}
```

Add note that estimated cost is currently a placeholder.

**Step 3: Update setup docs**

Add usage smoke test:

```md
After sending a router request, open `/dashboard` and check the Usage section. Change period filters to confirm reload behavior.
```

**Step 4: Update backlog notes**

Add note that basic usage dashboard thin slice is implemented.

**Step 5: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document usage dashboard flow"
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
/api/usage
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
git commit -m "chore: finalize usage dashboard slice"
```

---

## Manual Smoke Test With Supabase

With Supabase env configured and schema applied:

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Start router:
   ```bash
   npm run dev:router
   ```
3. Log in and open `/dashboard`.
4. Generate/copy an API key if needed.
5. Send a router request:
   ```bash
   curl http://localhost:8080/v1/chat/completions \
     -H "Authorization: Bearer <raw_key>" \
     -H "Content-Type: application/json" \
     -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'
   ```
6. Refresh the Usage section.
7. Confirm a recent event appears.
8. Switch between Today, 7 days, and 30 days.

---

## Deferred Work

Do not implement these in this plan:

- Charts.
- SQL aggregate views/functions.
- Billing/cost logic.
- Provider/model pricing tables.
- Request log detail pages.
- Real-time updates.
- Usage export.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-usage-dashboard-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-usage-dashboard-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
