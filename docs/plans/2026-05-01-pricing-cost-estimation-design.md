# NusaNexus Router — Pricing / Cost Estimation Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router already records token usage for successful non-streaming OpenAI-compatible chat completions:

- `prompt_tokens`
- `completion_tokens`
- `total_tokens`

The Usage API and dashboard currently expose token breakdowns, but `estimated_cost_usd` remains a placeholder value of `0`.

This slice adds workspace-level manual pricing rules so users can estimate usage cost without hardcoded provider prices or billing logic.

## Goals

- Add workspace-scoped manual pricing rules.
- Let users configure input/output USD per 1M tokens per model.
- Optionally scope a pricing rule to a specific provider connection.
- Compute estimated cost in `GET /api/usage` from stored token counts.
- Display estimated cost in the dashboard usage section.
- Add a minimal dashboard UI to create/list/disable pricing rules.

## Non-Goals

- Billing, invoices, subscriptions, or payments.
- Auto-importing provider pricing catalogs.
- Provider/model marketplace prices.
- Wildcard/regex model matching.
- Currency conversion.
- Router-side cost calculation.
- Historical cost freezing in `usage_events.estimated_cost_usd`.
- Charts/daily buckets.
- Failed-attempt cost accounting.

## Data Model

Add table:

```sql
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

create trigger trg_model_pricing_rules_updated_at
before update on model_pricing_rules
for each row execute function set_updated_at();
```

### Field Semantics

| field | meaning |
|---|---|
| `workspace_id` | workspace ownership boundary |
| `provider_connection_id` | optional provider-specific rule; `null` means workspace-wide |
| `model_pattern` | exact model match for MVP |
| `input_usd_per_1m_tokens` | prompt/input price per 1,000,000 tokens |
| `output_usd_per_1m_tokens` | completion/output price per 1,000,000 tokens |
| `currency` | fixed to `USD` for MVP |
| `status` | `active` or `disabled` |

## Matching Rules

For each usage event:

1. Use `event.model_resolved` as the model key.
2. Consider only rules with:
   - same `workspace_id`
   - `status = active`
   - exact `model_pattern === event.model_resolved`
3. Prefer provider-specific rules where:
   - `rule.provider_connection_id === event.provider_connection_id`
4. If no provider-specific rule exists, fall back to workspace-wide rule where:
   - `rule.provider_connection_id === null`
5. If no rule matches:
   - `estimated_cost_usd = 0`
   - `pricing_rule_missing = true`

## Cost Formula

```text
input_cost = prompt_tokens / 1_000_000 * input_usd_per_1m_tokens
output_cost = completion_tokens / 1_000_000 * output_usd_per_1m_tokens
estimated_cost_usd = input_cost + output_cost
```

`total_tokens` is not used for cost because providers usually price input and output tokens differently.

## API Design

### `GET /api/pricing/rules`

Lists active pricing rules for the current workspace.

Response:

```json
[
  {
    "id": "uuid",
    "provider_connection_id": null,
    "model_pattern": "gpt-4o-mini",
    "input_usd_per_1m_tokens": 0.15,
    "output_usd_per_1m_tokens": 0.6,
    "currency": "USD",
    "status": "active",
    "created_at": "2026-05-01T00:00:00.000Z"
  }
]
```

### `POST /api/pricing/rules`

Creates a pricing rule.

Request:

```json
{
  "provider_connection_id": null,
  "model_pattern": "gpt-4o-mini",
  "input_usd_per_1m_tokens": 0.15,
  "output_usd_per_1m_tokens": 0.6
}
```

Validation:

- `model_pattern` required.
- prices must be numbers `>= 0`.
- `provider_connection_id` optional.
- if `provider_connection_id` is set, provider must belong to workspace.
- currency is server-set to `USD`.
- status is server-set to `active`.

### `DELETE /api/pricing/rules/{id}`

Soft disables a pricing rule for the current workspace.

Response:

```json
{ "disabled": true }
```

### `GET /api/usage`

Usage API will continue to return current fields and additionally compute real cost estimates.

Per event:

```json
{
  "id": "usage-id",
  "model_resolved": "gpt-4o-mini",
  "prompt_tokens": 300,
  "completion_tokens": 150,
  "total_tokens": 450,
  "estimated_cost_usd": 0.000135,
  "pricing_rule_missing": false
}
```

Summary:

```json
{
  "total_requests": 12,
  "prompt_tokens": 2560,
  "completion_tokens": 1282,
  "total_tokens": 3842,
  "estimated_cost_usd": 0.001153,
  "success_rate": 0.92,
  "fallback_count": 1,
  "failed_count": 1
}
```

## Dashboard UX

Add a `Pricing rules` card.

### Create Rule Form

Fields:

- Provider: optional select
  - `Workspace-wide / any provider`
  - active/error/disconnected providers listed by display name
- Model pattern
- Input USD per 1M tokens
- Output USD per 1M tokens
- Add pricing rule button

### Rules List

Show active rules:

- Scope: provider name or workspace-wide
- Model pattern
- Input price
- Output price
- Created date
- Disable button

### Usage Section

Existing `Estimated cost` card becomes real computed value.

Recent usage event line adds:

```text
Cost: $0.000123
```

If no matching rule exists:

```text
Cost: not configured
```

## Security / Privacy

- No prompt or completion text is stored.
- No credentials are involved.
- Pricing rules are workspace-scoped.
- Provider ownership is checked before accepting provider-specific rules.
- Cost is computed from stored token counts only.

## Router Impact

No Go router changes expected.

Router already records token counts in `usage_events`. Cost estimation is a control-plane read concern for this MVP.

## Setup / Migration

Users must apply updated schema SQL to Supabase:

```text
docs/schema.sql
```

Existing workspaces without pricing rules will continue to work; estimated costs remain `0` until rules are added.

## Acceptance Criteria

- `model_pricing_rules` documented in schema SQL and DB docs.
- `GET /api/pricing/rules` lists active workspace rules.
- `POST /api/pricing/rules` creates workspace-scoped rules.
- `DELETE /api/pricing/rules/{id}` soft-disables rules.
- `GET /api/usage` computes per-event and summary estimated costs.
- Missing pricing rules are surfaced as `pricing_rule_missing: true` per event.
- Dashboard can create/list/disable pricing rules.
- Dashboard usage section displays estimated cost.
- Lint/build/tests pass.
