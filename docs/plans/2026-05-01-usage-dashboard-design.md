# NusaNexus Router — Usage Dashboard Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router now has a working MVP control-plane/data-plane loop:

- Supabase Auth login/signup with hybrid workspace auto-create.
- Dashboard provider/API-key creation and management.
- Router forwarding for non-streaming OpenAI-compatible chat completions.
- Supabase-backed API key validation, provider resolution, and usage event writes.

The next MVP gap is visibility. Users can send requests through the router, but the dashboard does not show usage activity yet.

## Goals

- Add `GET /api/usage` control-plane API.
- Return usage summary and recent usage events scoped to the active workspace.
- Add a dashboard Usage section.
- Support period filters: `today`, `7d`, `30d`.
- Keep implementation simple with app-layer aggregation over recent usage events.
- Avoid schema changes and charting libraries in this slice.

## Non-Goals

- Detailed charts.
- Cost calculation by model/provider.
- SQL views or RPC functions.
- Billing reports.
- Pagination beyond a simple limit.
- Export/download usage data.
- Request log detail pages.
- Real-time updates.

## Recommended Approach

Use `GET /api/usage?period=today|7d|30d&limit=50`.

The API route resolves workspace via the existing hybrid resolver, queries `usage_events` from Supabase PostgREST, computes a summary in JavaScript, and returns summary plus recent events.

This proves the router-to-Supabase-to-dashboard observability loop without adding database migrations or chart dependencies.

## API Design

### `GET /api/usage`

Request:

```http
GET /api/usage?period=7d&limit=50
Authorization: Bearer <supabase_access_token>
```

`DEV_WORKSPACE_ID` remains available as local fallback when no bearer token exists.

### Query Parameters

`period` allowlist:

```text
today | 7d | 30d
```

Default:

```text
today
```

`limit`:

```text
1 <= limit <= 100
```

Default:

```text
50
```

### Period Semantics

- `today`: since UTC start of current day.
- `7d`: since current time minus 7 days.
- `30d`: since current time minus 30 days.

UTC is acceptable for this MVP. Local timezone support is deferred.

### Supabase Query

Query `usage_events` scoped by workspace and since timestamp:

```text
usage_events?workspace_id=eq.<workspace>&created_at=gte.<since>&select=id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,total_tokens,status,error_code,created_at&order=created_at.desc&limit=<limit>
```

### Response

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
  "events": [
    {
      "id": "uuid",
      "provider_connection_id": "uuid",
      "api_key_id": "uuid",
      "request_id": "req_...",
      "model_requested": "auto",
      "model_resolved": "gpt-4o-mini",
      "total_tokens": 123,
      "status": "success",
      "error_code": null,
      "created_at": "2026-05-01T00:00:00Z"
    }
  ]
}
```

### Summary Rules

Given returned events:

- `total_requests`: `events.length`
- `total_tokens`: sum of `total_tokens` values, treating missing/null as 0
- `failed_count`: count where `status === 'failed'`
- `fallback_count`: count where `status === 'fallback'`
- `success_rate`: if no requests, `0`; otherwise `(total_requests - failed_count) / total_requests`
- `estimated_cost_usd`: `0` placeholder until pricing logic exists

## Dashboard Design

Update:

```text
apps/web/app/dashboard/dashboard-client.jsx
```

Add a Usage section with:

- Period selector buttons: Today, 7 days, 30 days.
- Summary cards:
  - Total requests
  - Total tokens
  - Success rate
  - Fallbacks
  - Failures
- Recent usage events list:
  - Status
  - Requested/resolved model
  - Total tokens
  - Error code
  - Created at
- Optional refresh button.

Usage state should be independent from provider/API-key management state so a usage fetch error does not break other dashboard sections.

## Helper Functions

Create:

```text
apps/web/lib/usage-summary.js
```

Responsibilities:

- Normalize period.
- Compute since timestamp.
- Clamp limit.
- Summarize events.

Example API:

```js
export function normalizeUsagePeriod(period) {}
export function usageSinceISOString(period, now = new Date()) {}
export function clampUsageLimit(limit) {}
export function summarizeUsageEvents(events) {}
```

This keeps API logic small and makes behavior easy to verify with Node import commands.

## Error Handling

API errors use the existing error envelope:

```json
{
  "error": {
    "code": "validation_error",
    "message": "invalid usage period"
  }
}
```

Expected codes:

- `validation_error` for invalid period/limit.
- `workspace_not_resolved` or `invalid_session` from workspace/auth resolver.
- `persistence_error` for Supabase failures.

Dashboard should show usage errors inside the Usage section only.

## Security Constraints

- Always scope usage queries by `workspace_id`.
- Do not return provider credentials.
- Do not return API key hashes or raw keys.
- Do not expose service role keys client-side.

## Router Considerations

The router already writes usage events through `RecordUsage`.

For this slice, token fields may remain `0` if the provider response does not include usage or the current router path does not parse it yet. More detailed token accounting and cost estimation are deferred.

## Testing Strategy

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Helper verification examples:

```bash
node -e "import('./apps/web/lib/usage-summary.js').then(m => console.log(m.normalizeUsagePeriod('7d')))"
node -e "import('./apps/web/lib/usage-summary.js').then(m => console.log(m.summarizeUsageEvents([{status:'success',total_tokens:3},{status:'failed',total_tokens:2}])))"
```

Manual smoke test with Supabase configured:

1. Log in.
2. Generate an API key if needed.
3. Send a router request.
4. Open `/dashboard`.
5. Confirm usage summary and recent event appear.
6. Change period filter and confirm section reloads.

## Acceptance Criteria

This slice is complete when:

- `GET /api/usage` exists.
- Usage API validates period and clamps limit.
- Usage API returns workspace-scoped summary and events.
- Dashboard displays usage summary.
- Dashboard displays recent usage events.
- Dashboard can switch between `today`, `7d`, and `30d`.
- Usage errors do not break provider/key management UI.
- Web lint/build pass.
- Go tests pass.
