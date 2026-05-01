# Usage Charts and Provider Breakdowns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the Usage API and dashboard with time-series usage buckets plus provider/model/status breakdowns.

**Architecture:** Add pure aggregation helpers in `apps/web/lib/usage-summary.js`, extend `GET /api/usage` to load an analytics event set and provider metadata, then render simple dependency-free CSS charts/tables in the dashboard. Keep existing `summary` and `events` response fields backward compatible.

**Tech Stack:** Next.js App Router, React client component, Supabase REST helper, plain JavaScript aggregation helpers, no chart library.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-usage-charts-provider-breakdowns-design.md
```

Relevant files:

```text
apps/web/lib/usage-summary.js
apps/web/app/api/usage/route.js
apps/web/app/dashboard/dashboard-client.jsx
docs/API_CONTRACT.md
docs/BACKLOG.md
docs/SETUP.md
README.md
```

Current `GET /api/usage` returns:

```js
{
  period,
  summary: summarizeUsageEvents(enrichedEvents),
  events: enrichedEvents
}
```

Current usage query selects recent limited events only:

```text
id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,prompt_tokens,completion_tokens,total_tokens,status,error_code,created_at
```

Current pricing behavior:

- load active `model_pricing_rules`
- call `enrichUsageEventsWithPricing(events, pricingRules)`
- returned events include `estimated_cost_usd` and `pricing_rule_missing`

Constraints:

- No DB changes.
- No router changes.
- No charting dependency.
- Keep `/api/usage` backward compatible.
- Analytics must not be computed only from returned recent `limit=50` events.

---

## Task 1: Add usage analytics aggregation helpers

**Files:**
- Modify: `apps/web/lib/usage-summary.js`

### Step 1: Add constants

At top near `allowedPeriods`, add:

```js
export const ANALYTICS_USAGE_EVENT_LIMIT = 5000;
```

### Step 2: Add bucket utility helpers

Append these helpers after existing exports:

```js
function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcHour(date) {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

function startOfUtcDay(date) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addHours(date, hours) {
  const copy = new Date(date);
  copy.setUTCHours(copy.getUTCHours() + hours);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatBucketLabel(date, period) {
  if (period === 'today') {
    return `${String(date.getUTCHours()).padStart(2, '0')}:00`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function emptyAggregate() {
  return {
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    failed_count: 0,
    fallback_count: 0
  };
}

function addEventToAggregate(aggregate, event) {
  aggregate.requests += 1;
  aggregate.prompt_tokens += Number(event.prompt_tokens || 0);
  aggregate.completion_tokens += Number(event.completion_tokens || 0);
  aggregate.total_tokens += Number(event.total_tokens || 0);
  aggregate.estimated_cost_usd += Number(event.estimated_cost_usd || 0);
  if (event.status === 'failed') aggregate.failed_count += 1;
  if (event.status === 'fallback') aggregate.fallback_count += 1;
  return aggregate;
}

function finalizeAggregate(aggregate) {
  return {
    ...aggregate,
    success_rate: aggregate.requests === 0 ? 0 : (aggregate.requests - aggregate.failed_count) / aggregate.requests
  };
}
```

### Step 3: Add bucket generation export

Append:

```js
export function buildUsageBuckets(events, period, now = new Date()) {
  const normalized = normalizeUsagePeriod(period);
  const safeEvents = Array.isArray(events) ? events : [];
  const since = new Date(usageSinceISOString(normalized, now));
  const bucketMap = new Map();

  let cursor;
  let end;
  let step;

  if (normalized === 'today') {
    cursor = startOfUtcHour(since);
    end = startOfUtcHour(now);
    step = (date) => addHours(date, 1);
  } else {
    cursor = startOfUtcDay(since);
    end = startOfUtcDay(now);
    step = (date) => addDays(date, 1);
  }

  while (cursor.getTime() <= end.getTime()) {
    bucketMap.set(cursor.toISOString(), emptyAggregate());
    cursor = step(cursor);
  }

  for (const event of safeEvents) {
    const eventDate = toDate(event.created_at);
    if (!eventDate) continue;
    const bucketDate = normalized === 'today' ? startOfUtcHour(eventDate) : startOfUtcDay(eventDate);
    const key = bucketDate.toISOString();
    if (!bucketMap.has(key)) continue;
    addEventToAggregate(bucketMap.get(key), event);
  }

  return Array.from(bucketMap.entries()).map(([bucket, aggregate]) => ({
    bucket,
    label: formatBucketLabel(new Date(bucket), normalized),
    ...finalizeAggregate(aggregate)
  }));
}
```

Note: For `7d`, this yields today plus the date 7 days ago. That matches the existing `usageSinceISOString('7d')` behavior. Do not change period semantics in this slice.

### Step 4: Add provider breakdown export

Append:

```js
export function buildProviderBreakdown(events, providers = []) {
  const providerMap = new Map((Array.isArray(providers) ? providers : []).map((provider) => [provider.id, provider]));
  const groups = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const providerId = event.provider_connection_id || 'unknown';
    if (!groups.has(providerId)) groups.set(providerId, emptyAggregate());
    addEventToAggregate(groups.get(providerId), event);
  }

  return Array.from(groups.entries())
    .map(([providerId, aggregate]) => {
      const provider = providerMap.get(providerId);
      return {
        provider_connection_id: providerId === 'unknown' ? null : providerId,
        display_name: provider?.display_name || 'Unknown provider',
        provider_type: provider?.provider_type || null,
        ...finalizeAggregate(aggregate)
      };
    })
    .sort((a, b) => (b.requests - a.requests) || (b.total_tokens - a.total_tokens));
}
```

### Step 5: Add model breakdown export

Append:

```js
export function buildModelBreakdown(events) {
  const groups = new Map();
  const missingPricingCounts = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const model = event.model_resolved || event.model_requested || 'unknown';
    if (!groups.has(model)) groups.set(model, emptyAggregate());
    addEventToAggregate(groups.get(model), event);
    if (event.pricing_rule_missing) missingPricingCounts.set(model, (missingPricingCounts.get(model) || 0) + 1);
  }

  return Array.from(groups.entries())
    .map(([model, aggregate]) => ({
      model,
      ...finalizeAggregate(aggregate),
      pricing_rule_missing_count: missingPricingCounts.get(model) || 0
    }))
    .sort((a, b) => (b.total_tokens - a.total_tokens) || (b.requests - a.requests));
}
```

### Step 6: Add status breakdown export

Append:

```js
export function buildStatusBreakdown(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const groups = new Map();

  for (const event of safeEvents) {
    const status = event.status || 'unknown';
    if (!groups.has(status)) groups.set(status, emptyAggregate());
    addEventToAggregate(groups.get(status), event);
  }

  return Array.from(groups.entries())
    .map(([status, aggregate]) => ({
      status,
      ...finalizeAggregate(aggregate),
      percentage: safeEvents.length === 0 ? 0 : aggregate.requests / safeEvents.length
    }))
    .sort((a, b) => b.requests - a.requests);
}
```

### Step 7: Add combined export

Append:

```js
export function buildUsageAnalytics(events, providers, period, now = new Date()) {
  const safeEvents = Array.isArray(events) ? events : [];
  return {
    analytics: {
      event_count: safeEvents.length,
      truncated: safeEvents.length >= ANALYTICS_USAGE_EVENT_LIMIT,
      max_events: ANALYTICS_USAGE_EVENT_LIMIT
    },
    charts: {
      usage_buckets: buildUsageBuckets(safeEvents, period, now)
    },
    breakdowns: {
      providers: buildProviderBreakdown(safeEvents, providers),
      models: buildModelBreakdown(safeEvents),
      statuses: buildStatusBreakdown(safeEvents)
    }
  };
}
```

### Step 8: Quick syntax check

Run:

```bash
npm run lint:web
```

Expected: PASS.

### Step 9: Commit

```bash
git add apps/web/lib/usage-summary.js
git commit -m "feat: add usage analytics helpers"
```

---

## Task 2: Extend `/api/usage` with analytics response fields

**Files:**
- Modify: `apps/web/app/api/usage/route.js`

### Step 1: Update imports

Replace existing usage-summary import:

```js
import { clampUsageLimit, normalizeUsagePeriod, summarizeUsageEvents, usageSinceISOString } from '../../../lib/usage-summary.js';
```

with:

```js
import {
  ANALYTICS_USAGE_EVENT_LIMIT,
  buildUsageAnalytics,
  clampUsageLimit,
  normalizeUsagePeriod,
  summarizeUsageEvents,
  usageSinceISOString
} from '../../../lib/usage-summary.js';
```

### Step 2: Add analytics fields constant

Inside `GET`, after `since`:

```js
const eventSelect = 'id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,prompt_tokens,completion_tokens,total_tokens,status,error_code,created_at';
```

### Step 3: Use constant for current recent events query

Change current `select=...` query to:

```js
`?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(since)}&select=${eventSelect}&order=created_at.desc&limit=${limit}`
```

### Step 4: Load analytics events

After recent `events` query, add:

```js
const analyticsEvents = await supabaseSelect(
  'usage_events',
  `?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(since)}&select=${eventSelect}&order=created_at.asc&limit=${ANALYTICS_USAGE_EVENT_LIMIT}`
);
```

### Step 5: Load provider metadata

After pricing rules query or before enrichment, add:

```js
const providers = await supabaseSelect(
  'provider_connections',
  `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,display_name`
);
```

### Step 6: Enrich both event sets

Change:

```js
const enrichedEvents = enrichUsageEventsWithPricing(events, pricingRules);
```

To:

```js
const enrichedEvents = enrichUsageEventsWithPricing(events, pricingRules);
const enrichedAnalyticsEvents = enrichUsageEventsWithPricing(analyticsEvents, pricingRules);
const usageAnalytics = buildUsageAnalytics(enrichedAnalyticsEvents, providers, period);
```

### Step 7: Return backward-compatible extended response

Change response body to:

```js
return NextResponse.json({
  period,
  summary: summarizeUsageEvents(enrichedAnalyticsEvents),
  events: enrichedEvents,
  ...usageAnalytics
});
```

Important: summary now uses the full loaded analytics event set rather than only recent limited events. This improves correctness and is acceptable because it preserves field shape.

### Step 8: Verify

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

### Step 9: Commit

```bash
git add apps/web/app/api/usage/route.js
git commit -m "feat: return usage analytics breakdowns"
```

---

## Task 3: Render simple usage charts and breakdowns in dashboard

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

### Step 1: Add helper formatters if not already present

Search for existing formatting helpers in this file. Reuse if available.

If missing, add near top-level helper functions:

```js
function formatInteger(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(6)}`;
}
```

If equivalent helpers already exist, do not duplicate names. Extend existing helpers as needed.

### Step 2: Add max helper

Add:

```js
function maxMetric(rows, metric) {
  return Math.max(1, ...(Array.isArray(rows) ? rows.map((row) => Number(row?.[metric] || 0)) : []));
}
```

### Step 3: Add simple bar component

Add before `DashboardClient`:

```jsx
function MetricBar({ value, max, color = '#2563eb' }) {
  const width = Math.max(2, Math.round((Number(value || 0) / Math.max(1, Number(max || 1))) * 100));
  return (
    <div style={{ height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
      <div style={{ width: `${width}%`, height: '100%', borderRadius: 999, background: color }} />
    </div>
  );
}
```

### Step 4: Add usage trend component

Add:

```jsx
function UsageTrend({ buckets }) {
  const rows = Array.isArray(buckets) ? buckets : [];
  const maxRequests = maxMetric(rows, 'requests');

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No usage buckets available yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((bucket) => (
        <div key={bucket.bucket} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 92px', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span style={{ color: '#4b5563' }}>{bucket.label}</span>
          <MetricBar value={bucket.requests} max={maxRequests} />
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{formatInteger(bucket.requests)} req</span>
          <span />
          <span style={{ color: '#6b7280' }}>{formatInteger(bucket.total_tokens)} tokens · {formatUsd(bucket.estimated_cost_usd)}</span>
          <span style={{ textAlign: 'right', color: '#6b7280' }}>{formatPercent(bucket.success_rate)}</span>
        </div>
      ))}
    </div>
  );
}
```

### Step 5: Add provider breakdown component

Add:

```jsx
function ProviderBreakdown({ providers }) {
  const rows = Array.isArray(providers) ? providers : [];
  const maxRequests = maxMetric(rows, 'requests');

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No provider usage yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((provider) => (
        <div key={provider.provider_connection_id || provider.display_name} style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>{provider.display_name}</strong>
            <span>{formatInteger(provider.requests)} req</span>
          </div>
          <MetricBar value={provider.requests} max={maxRequests} color="#16a34a" />
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            {formatInteger(provider.total_tokens)} tokens · {formatUsd(provider.estimated_cost_usd)} · success {formatPercent(provider.success_rate)}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Step 6: Add model breakdown component

Add:

```jsx
function ModelBreakdown({ models }) {
  const rows = Array.isArray(models) ? models : [];
  const maxTokens = maxMetric(rows, 'total_tokens');

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No model usage yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((model) => (
        <div key={model.model} style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>{model.model}</strong>
            <span>{formatInteger(model.total_tokens)} tokens</span>
          </div>
          <MetricBar value={model.total_tokens} max={maxTokens} color="#7c3aed" />
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            {formatInteger(model.requests)} req · {formatUsd(model.estimated_cost_usd)} · success {formatPercent(model.success_rate)}
            {model.pricing_rule_missing_count ? ` · ${formatInteger(model.pricing_rule_missing_count)} missing pricing` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Step 7: Add status breakdown component

Add:

```jsx
function StatusBreakdown({ statuses }) {
  const rows = Array.isArray(statuses) ? statuses : [];
  const maxRequests = maxMetric(rows, 'requests');
  const colors = { success: '#16a34a', failed: '#dc2626', fallback: '#f59e0b', unknown: '#6b7280' };

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No status usage yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((status) => (
        <div key={status.status} style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>{status.status}</strong>
            <span>{formatInteger(status.requests)} req · {formatPercent(status.percentage)}</span>
          </div>
          <MetricBar value={status.requests} max={maxRequests} color={colors[status.status] || colors.unknown} />
        </div>
      ))}
    </div>
  );
}
```

### Step 8: Render analytics section

Find the existing Usage card in JSX. Search:

```text
Usage
```

Under the existing summary/recent events section, add a new card or sub-section:

```jsx
<section style={cardStyle}>
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
    <div>
      <h2 style={{ margin: 0 }}>Usage analytics</h2>
      <p style={{ margin: '4px 0 0', color: '#6b7280' }}>Trends and breakdowns for the selected period.</p>
    </div>
    {usage?.analytics?.truncated ? (
      <span style={{ color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 700 }}>
        First {formatInteger(usage.analytics.max_events)} events
      </span>
    ) : null}
  </div>

  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Usage trend</h3>
      <UsageTrend buckets={usage?.charts?.usage_buckets} />
    </div>
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Status breakdown</h3>
      <StatusBreakdown statuses={usage?.breakdowns?.statuses} />
    </div>
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Provider breakdown</h3>
      <ProviderBreakdown providers={usage?.breakdowns?.providers} />
    </div>
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Model breakdown</h3>
      <ModelBreakdown models={usage?.breakdowns?.models} />
    </div>
  </div>
</section>
```

Placement recommendation: immediately after current Usage summary/recent event card or inside it after recent events. Keep layout readable.

### Step 9: Verify

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS. The build may warn about `middleware` convention; do not fix that in this task.

### Step 10: Commit

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: show usage analytics dashboard"
```

---

## Task 4: Update docs and API contract

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

### Step 1: README

Add current features bullet near existing usage bullet:

```md
- Dashboard shows usage charts and provider/model/status breakdowns
```

Update Next Build Steps:

```md
## Next Build Steps
1. Add provider tags for primary/backup/free/cheap routing hints
2. Add better onboarding wizard with persisted checklist
3. Add password reset and OAuth provider login polish
4. Migrate Next.js middleware file convention to proxy
```

### Step 2: API contract

Find `GET /api/usage` section in `docs/API_CONTRACT.md`.

Update response example to include:

```json
{
  "period": "7d",
  "summary": {
    "total_requests": 2,
    "prompt_tokens": 200,
    "completion_tokens": 100,
    "total_tokens": 300,
    "success_rate": 1,
    "fallback_count": 0,
    "failed_count": 0,
    "estimated_cost_usd": 0.00012
  },
  "analytics": {
    "event_count": 2,
    "truncated": false,
    "max_events": 5000
  },
  "charts": {
    "usage_buckets": [
      {
        "bucket": "2026-05-01T00:00:00.000Z",
        "label": "May 1",
        "requests": 2,
        "prompt_tokens": 200,
        "completion_tokens": 100,
        "total_tokens": 300,
        "estimated_cost_usd": 0.00012,
        "failed_count": 0,
        "fallback_count": 0,
        "success_rate": 1
      }
    ]
  },
  "breakdowns": {
    "providers": [],
    "models": [],
    "statuses": []
  },
  "events": []
}
```

Document that `summary`, `charts`, and `breakdowns` are computed from up to 5000 period events, while `events` remains the recent limited list.

### Step 3: SETUP

Add smoke verification step:

```md
After generating traffic, open `/dashboard`, switch usage period, and confirm Usage analytics shows trend bars plus provider/model/status breakdowns.
```

### Step 4: BACKLOG

Mark current item complete:

```md
- [x] Usage charts and provider breakdowns
```

If the item does not exist, add it under completed/current MVP items.

### Step 5: Verify docs changed

Run:

```bash
git diff -- README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
```

Review for old/current conflicts.

### Step 6: Commit

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document usage analytics breakdowns"
```

---

## Task 5: Final verification

Run from repo root:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint PASS
- build PASS
- Go tests PASS

Check status:

```bash
git status --short
git log --oneline --decorate -10
```

Expected:

- clean except `.pi/` if present
- commits include:
  - `feat: add usage analytics helpers`
  - `feat: return usage analytics breakdowns`
  - `feat: show usage analytics dashboard`
  - `docs: document usage analytics breakdowns`

---

## Manual Smoke Test

With app and Supabase configured:

1. Start router and web.
2. Generate at least one router request.
3. Open `/dashboard`.
4. Confirm Usage summary still appears.
5. Confirm Usage analytics appears.
6. Change period between `today`, `7d`, and `30d`.
7. Confirm trend bucket labels change appropriately.
8. Confirm provider breakdown uses provider display name.
9. Confirm model breakdown groups by model name.
10. Confirm status breakdown includes success/failed/fallback as applicable.

---

## Deferred Work

Do not implement:

- chart library
- realtime updates
- custom date range picker
- provider tags
- provider routing hints
- new DB indexes
- router latency tracking
- server-rendered dashboard usage data

---

## Execution Handoff

Plan saved to:

```text
docs/plans/2026-05-01-usage-charts-provider-breakdowns-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-usage-charts-provider-breakdowns-implementation.md

Follow the plan exactly, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
