# NusaNexus Router — Usage Charts and Provider Breakdowns Design

Date: 2026-05-01
Status: Approved

## Context

The current dashboard usage slice shows:

- summary request count
- token breakdown
- estimated cost
- recent events

The current `GET /api/usage` response is limited by the recent event limit and does not include time-series chart buckets or provider/model breakdowns.

This makes the dashboard useful for recent debugging but weak for answering operational questions:

- Which provider handled most traffic?
- Which model consumed the most tokens/cost?
- How did usage trend over the selected period?
- Are failures concentrated around one provider or status?

## Goals

- Extend `GET /api/usage` with server-computed chart buckets.
- Extend `GET /api/usage` with provider/model/status breakdowns.
- Keep response backward compatible for current summary/events UI.
- Avoid a charting dependency for the MVP.
- Render simple dashboard charts/tables using CSS and existing React.
- Use existing pricing enrichment so cost totals match the current Usage API behavior.

## Non-Goals

- No new database tables.
- No router changes.
- No billing/invoicing.
- No chart library.
- No realtime analytics.
- No custom date-range picker beyond existing `today`, `7d`, `30d` periods.
- No percentile latency metrics; usage events do not currently store latency.
- No provider catalog or model taxonomy.

## API Shape

`GET /api/usage?period=today|7d|30d&limit=50` remains backward compatible and adds:

```json
{
  "period": "7d",
  "summary": {},
  "events": [],
  "charts": {
    "usage_buckets": []
  },
  "breakdowns": {
    "providers": [],
    "models": [],
    "statuses": []
  }
}
```

### Chart Buckets

The API computes buckets from all events in the selected period, not just the returned recent event limit.

Bucket granularity:

- `today`: hourly UTC buckets.
- `7d`: daily UTC buckets.
- `30d`: daily UTC buckets.

Bucket row:

```json
{
  "bucket": "2026-05-01T13:00:00.000Z",
  "label": "13:00",
  "requests": 4,
  "prompt_tokens": 1200,
  "completion_tokens": 300,
  "total_tokens": 1500,
  "estimated_cost_usd": 0.0042,
  "failed_count": 1,
  "fallback_count": 0,
  "success_rate": 0.75
}
```

For daily buckets, labels are short dates such as `May 1`.

Empty buckets should be included so charts do not visually skip quiet periods.

### Provider Breakdown

Provider rows are grouped by `provider_connection_id` and enriched with display metadata from `provider_connections`.

```json
{
  "provider_connection_id": "uuid",
  "display_name": "OpenAI production",
  "provider_type": "openai_compatible",
  "requests": 20,
  "prompt_tokens": 10000,
  "completion_tokens": 4000,
  "total_tokens": 14000,
  "estimated_cost_usd": 0.034,
  "failed_count": 1,
  "fallback_count": 2,
  "success_rate": 0.95
}
```

If a provider is missing or deleted, use:

```text
Unknown provider
```

Rows are sorted by descending `requests`, then descending `total_tokens`.

### Model Breakdown

Model rows group by:

```js
model_resolved || model_requested || 'unknown'
```

```json
{
  "model": "gpt-4o-mini",
  "requests": 12,
  "prompt_tokens": 5000,
  "completion_tokens": 2000,
  "total_tokens": 7000,
  "estimated_cost_usd": 0.018,
  "failed_count": 0,
  "fallback_count": 1,
  "success_rate": 1,
  "pricing_rule_missing_count": 0
}
```

Rows are sorted by descending `total_tokens`, then descending `requests`.

### Status Breakdown

Status rows group by `status || 'unknown'`.

```json
{
  "status": "success",
  "requests": 25,
  "prompt_tokens": 12000,
  "completion_tokens": 5000,
  "total_tokens": 17000,
  "estimated_cost_usd": 0.044,
  "percentage": 0.89
}
```

Rows are sorted by descending `requests`.

## Data Loading

Current route loads recent `events` with a limit. To avoid distorted chart/breakdown analytics, the API should load a second analytics event set for the selected period.

MVP limit for analytics events:

```text
5000 rows
```

Reasoning:

- It prevents accidental huge responses/work.
- It is enough for early MVP usage.
- The UI can still report if analytics may be truncated.

Add response metadata:

```json
{
  "analytics": {
    "event_count": 123,
    "truncated": false,
    "max_events": 5000
  }
}
```

If exactly `5000` rows are loaded, set `truncated: true` because more rows may exist.

## Pricing and Cost

Use the existing pricing helpers:

- load active `model_pricing_rules`
- call `enrichUsageEventsWithPricing()`
- aggregate `estimated_cost_usd`
- preserve `pricing_rule_missing` on recent events
- count missing pricing rules in model breakdown when available

No cost calculation should move to the router.

## Dashboard UI

Add a new section under the existing Usage card.

Suggested cards:

1. **Usage trend**
   - simple vertical/horizontal CSS bars for requests
   - show total tokens and estimated cost per bucket in text

2. **Provider breakdown**
   - table/list with provider name, requests, tokens, estimated cost, success rate
   - horizontal proportional bar by request count

3. **Model breakdown**
   - table/list with model, requests, tokens, estimated cost
   - show missing pricing count if non-zero

4. **Status breakdown**
   - compact bars for success/failed/fallback/unknown

Use existing formatting helpers or add small local helpers in `dashboard-client.jsx`:

- integer formatting
- percentage formatting
- USD formatting

Do not add third-party UI or chart dependencies.

## Error Handling

- Invalid period still returns current `400 validation_error`.
- Supabase failures still return route-level `4xx/5xx` response.
- Empty usage returns empty breakdown arrays and zero-valued buckets for the selected period.
- Unknown provider/model/status values should never crash aggregation.

## Testing Strategy

Unit-test pure aggregation helpers in `apps/web/lib/usage-summary.js` if practical.

At minimum verify:

- bucket generation for `today`, `7d`, `30d`
- provider grouping with unknown provider fallback
- model grouping by resolved/requested/unknown priority
- status grouping percentage
- cost/token sums

Final verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

## Acceptance Criteria

- `GET /api/usage` still returns existing `period`, `summary`, and `events` fields.
- `GET /api/usage` returns `charts.usage_buckets`.
- `GET /api/usage` returns `breakdowns.providers`, `breakdowns.models`, and `breakdowns.statuses`.
- Analytics are computed from all loaded period events, not just recent `limit` events.
- Dashboard renders simple usage trend bars.
- Dashboard renders provider breakdown.
- Dashboard renders model breakdown.
- Dashboard renders status breakdown.
- Empty usage state works.
- Docs/backlog updated.
- Lint/build/router tests pass.
