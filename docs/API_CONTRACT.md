# API Contract — NusaNexus Router MVP

## 1. Public Control-Plane APIs

These APIs are served by the web/control plane layer (Next.js on Vercel) and talk to Supabase.

### Auth Header (all control-plane APIs)
```
Authorization: Bearer <supabase_access_token>
```
Current thin slice accepts `Authorization: Bearer <supabase_access_token>` from the browser. Production cookie/SSR auth polish is deferred.
All control-plane APIs require an authenticated Supabase session. Unauthenticated requests return `401`.

---

### `GET /api/workspaces/current`
Returns the active workspace context.

**Response `200` authenticated**
```json
{
  "id": "uuid",
  "name": "alice's Workspace",
  "slug": "alice-abc123",
  "role": "owner",
  "auth_mode": "authenticated",
  "user": {
    "email": "alice@example.com"
  }
}
```

**Response `200` dev fallback**
```json
{
  "id": "dev-workspace-id",
  "name": "Development Workspace",
  "slug": null,
  "role": "dev",
  "auth_mode": "dev_fallback",
  "user": null
}
```

**Errors:** `401` unauthorized, `404` no workspace found

---

### `GET /api/providers`
Returns provider connections for the active workspace.

**Response `200`**
```json
[
  {
    "id": "uuid",
    "provider_type": "codex",
    "display_name": "Codex OAuth",
    "auth_method": "oauth",
    "status": "active",
    "quota_state": { "remaining_pct": 85 },
    "last_checked_at": "2026-01-01T12:00:00Z"
  }
]
```

**Errors:** `401` unauthorized

---

### `POST /api/providers`
Creates a new provider connection.

**Request Body**
```json
{
  "provider_type": "openai_compatible",
  "display_name": "My Provider",
  "auth_method": "api_key",
  "base_url": "https://api.example.com",
  "api_key": "sk-xxxxxxxxxxxx",
  "default_model": "gpt-4o-mini",
  "tags": ["primary", "cheap"]
}
```

> `api_key` is encrypted before storing and is never returned by the API.

**Response `201`**
```json
{
  "id": "uuid",
  "provider_type": "openai_compatible",
  "display_name": "My Provider",
  "auth_method": "api_key",
  "status": "active",
  "metadata": {
    "base_url": "https://api.example.com",
    "default_model": "gpt-4o-mini",
    "tags": ["primary", "cheap"]
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

For the thin slice, provider creation ensures a default routing preset exists and appends the provider as a `failover` step.

**Errors:** `401` unauthorized, `400` validation error, `409` duplicate provider

---

### `PATCH /api/providers/{id}`
Reconnects or rotates an existing OpenAI-compatible API-key provider.

**Request**
```json
{
  "display_name": "OpenAI production",
  "base_url": "https://api.openai.com",
  "default_model": "gpt-4o-mini",
  "api_key": "sk-new"
}
```

**Response `200`**
```json
{
  "id": "uuid",
  "provider_type": "openai_compatible",
  "display_name": "OpenAI production",
  "auth_method": "api_key",
  "status": "active",
  "metadata": {
    "base_url": "https://api.openai.com",
    "default_model": "gpt-4o-mini",
    "tags": ["primary", "cheap"]
  },
  "quota_state": {},
  "last_checked_at": null,
  "created_at": "2026-05-01T00:00:00.000Z"
}
```

The response never includes `credential_encrypted` or raw credential material. Health check remains manual after reconnect. If `tags` is omitted during reconnect, existing provider tags are preserved.

**Errors:** `401` unauthorized, `404` not found, `400` validation error

---

### `PATCH /api/providers/:id/tags`
Updates provider routing hint tags.

Allowed tags: `primary`, `backup`, `free`, `cheap`. Unknown tags are ignored during normalization.

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

The response never includes `credential_encrypted` or raw credential material. Tags do not directly change router behavior. The dashboard can use them to suggest a default fallback-chain draft, but routing changes only after the user saves the default chain.

**Errors:** `401` unauthorized, `404` not found, `400` validation error

---

### `DELETE /api/providers/:id`
Disconnects a provider connection.

**Response `200`**
```json
{ "disconnected": true }
```

**Errors:** `401` unauthorized, `404` not found

---

### `POST /api/providers/:id/check`
Runs a manual health check for an OpenAI-compatible API-key provider.

**Response `200` healthy**
```json
{
  "id": "uuid",
  "status": "active",
  "health": "healthy",
  "last_checked_at": "2026-05-01T00:00:00Z",
  "message": "Provider check passed"
}
```

**Response `200` unhealthy**
```json
{
  "id": "uuid",
  "status": "error",
  "health": "error",
  "last_checked_at": "2026-05-01T00:00:00Z",
  "error_code": "provider_check_failed",
  "message": "Provider returned 401"
}
```

**Errors:** `401` unauthorized, `404` not found, `400` validation error

Dashboard health explanations are derived from sanitized provider health metadata (`quota_state.health`, optional `last_error_message`) and health-check `error_code`/`message` fields. Credential material is never returned.

---

### `GET /api/presets/default`
Returns the active workspace's default routing preset and enriched fallback chain.

**Response `200`**
```json
{
  "id": "uuid",
  "name": "Default",
  "description": "Default routing preset",
  "is_default": true,
  "steps": [
    {
      "id": "uuid",
      "order_index": 1,
      "provider_connection_id": "uuid",
      "provider_type": "openai_compatible",
      "display_name": "My Provider",
      "status": "active",
      "health": "healthy",
      "model_alias": null,
      "fallback_mode": "failover"
    }
  ]
}
```

**Errors:** `401` unauthorized, `400` validation error

### `PUT /api/presets/default`
Replaces the default fallback chain.

**Request Body**
```json
{
  "steps": [
    {
      "provider_connection_id": "uuid",
      "model_alias": "gpt-4o"
    },
    {
      "provider_connection_id": "uuid",
      "model_alias": null
    }
  ]
}
```

**Response `200`**
```json
{
  "id": "uuid",
  "name": "Default",
  "description": "Default routing preset",
  "is_default": true,
  "steps": [
    {
      "id": "uuid",
      "order_index": 1,
      "provider_connection_id": "uuid",
      "provider_type": "openai_compatible",
      "display_name": "My Provider",
      "status": "active",
      "health": "healthy",
      "model_alias": "gpt-4o",
      "fallback_mode": "failover"
    }
  ]
}
```

**Errors:** `401` unauthorized, `400` validation error, `404` provider not found

The dashboard may build a local draft suggestion from provider tags (`primary`, `cheap`, `free`, `backup`). This suggestion is not persisted until `PUT /api/presets/default` is called.

> MVP note: `/api/presets/default` is the implemented preset route for the current thin slice.

### `GET /api/presets`
Returns routing presets for the active workspace.

**Response `200`**
```json
[
  {
    "id": "uuid",
    "name": "Hemat",
    "description": "Prioritaskan provider murah",
    "is_default": true,
    "steps": [
      {
        "order_index": 1,
        "provider_connection_id": "uuid",
        "provider_type": "minimax",
        "model_alias": null,
        "fallback_mode": "failover"
      }
    ]
  }
]
```

**Errors:** `401` unauthorized

---

### `POST /api/presets`
Creates a routing preset.

**Request Body**
```json
{
  "name": "Custom Preset",
  "description": "My custom routing",
  "is_default": false,
  "steps": [
    {
      "provider_connection_id": "uuid",
      "model_alias": "gpt-4o",
      "fallback_mode": "failover",
      "order_index": 1
    },
    {
      "provider_connection_id": "uuid",
      "model_alias": null,
      "fallback_mode": "failover",
      "order_index": 2
    }
  ]
}
```

**Response `201`**
```json
{
  "id": "uuid",
  "name": "Custom Preset",
  "is_default": false,
  "created_at": "2026-01-01T00:00:00Z"
}
```

**Errors:** `401` unauthorized, `400` validation error

---

### `GET /api/endpoint`
Returns endpoint config and snippets for the active workspace.

**Response `200`**
```json
{
  "base_url": "https://router.yourdomain.com",
  "api_key_prefix": "nnr_a1b2",
  "model": "auto",
  "active_preset": "Hemat",
  "snippets": {
    "claude_code": "OPENAI_API_BASE=https://router.yourdomain.com/v1\nOPENAI_API_KEY=nnr_...",
    "cursor": "{ \"openai.apiBase\": \"https://router.yourdomain.com/v1\", ... }",
    "codex": "..."
  }
}
```

**Errors:** `401` unauthorized, `404` no API key generated

---

### `GET /api/endpoint/keys`
Returns API keys for the active workspace.

**Response `200`**
```json
[
  {
    "id": "uuid",
    "name": "Claude Code laptop",
    "prefix": "nnr_a1b2",
    "created_at": "2026-01-01T00:00:00Z",
    "last_used_at": null,
    "revoked_at": null
  }
]
```

**Errors:** `401` unauthorized

---

### `POST /api/endpoint/keys`
Generate a new API key.

**Request Body**
```json
{
  "name": "Claude Code laptop"
}
```

**Response `201`**
```json
{
  "id": "uuid",
  "name": "Claude Code laptop",
  "prefix": "nnr_a1b2",
  "raw_key": "nnr_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "created_at": "2026-01-01T00:00:00Z"
}
```

> `raw_key` is shown **once only**. It is not stored. Generated keys use the `nnr_` prefix.

**Errors:** `401` unauthorized, `400` validation error

---

### `DELETE /api/endpoint/keys/:id`
Revoke an API key.

**Response `200`**
```json
{ "revoked": true }
```

**Errors:** `401` unauthorized, `404` not found

---

### `GET /api/onboarding`
Returns workspace Quick start onboarding progress. Resource-backed steps are derived from providers, health state, API keys, and usage events. Explicit user-only steps are read from `workspaces.metadata.onboarding`.

**Response `200`**
```json
{
  "dismissed": false,
  "steps": [
    {
      "id": "connect_provider",
      "label": "Connect a provider",
      "description": "Add an OpenAI-compatible API-key provider.",
      "source": "derived",
      "complete": true
    },
    {
      "id": "check_provider_health",
      "label": "Run a provider health check",
      "description": "Verify NusaNexus Router can reach at least one provider.",
      "source": "derived",
      "complete": true
    },
    {
      "id": "generate_router_key",
      "label": "Generate a router API key",
      "description": "Create a key for Claude Code, Codex, OpenClaw, Cursor, or cURL.",
      "source": "derived",
      "complete": true
    },
    {
      "id": "copy_client_snippet",
      "label": "Copy a client snippet",
      "description": "Copy a ready-to-use setup snippet from Endpoint config.",
      "source": "persisted",
      "complete": false
    },
    {
      "id": "send_first_request",
      "label": "Send your first request",
      "description": "Make one successful request through the hosted router.",
      "source": "derived",
      "complete": false
    }
  ],
  "completed_count": 3,
  "total_count": 5
}
```

**Errors:** `401` unauthorized, `404` workspace not found

---

### `PATCH /api/onboarding`
Updates explicit persisted onboarding state for the active workspace.

Only `copy_client_snippet` can be set through `completed_steps`; provider, health, API-key, and first-request progress are derived server-side and cannot be marked complete by the client.

**Request Body**
```json
{
  "completed_steps": ["copy_client_snippet"],
  "dismissed": false
}
```

**Response `200`**
Returns the same shape as `GET /api/onboarding` after merging persisted metadata and derived resource state.

**Errors:** `401` unauthorized, `400` validation error, `404` workspace not found

---

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

---

### `GET /api/usage`
Returns usage summary, analytics charts/breakdowns, and recent events.

**Query Parameters**
- `period` — `today`, `7d`, `30d` (default: `today`)
- `limit` — max events to return (default: `50`, clamped to `1..100`)

**Response `200`**
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

`estimated_cost_usd` is computed from active manual pricing rules. If no rule matches an event, that event returns `estimated_cost_usd: 0` and `pricing_rule_missing: true`.

`summary`, `charts`, and `breakdowns` are computed from up to 5000 events for the selected period. `events` remains the recent list controlled by `limit` (default 50, max 100) for backward compatibility.

Token fields are parsed from successful OpenAI-compatible provider responses when available. Missing provider usage is recorded as zero.

Dashboard usage-event explanations are derived client-side from each event `status` and `error_code` (for example: fallback, invalid key, provider failure). No prompt contents or provider response bodies are stored or returned for these explanations.

On the router data plane, authenticated failures (after API-key resolution succeeds) are recorded as `usage_events` with `status = "failed"`, a structured `error_code`, and all token counts set to `0`. Missing or invalid router API keys do not produce usage events because no workspace can be safely resolved.

**Errors:** `401` unauthorized, `400` validation error

---

## 2. Router Data-Plane APIs
These APIs are served by the VPS router service.

### `GET /health`
Health check.

### `POST /v1/chat/completions`
OpenAI-compatible chat completions endpoint.

### Required Headers
- `Authorization: Bearer <api_key>`
- `Content-Type: application/json`

### Request Body
Standard OpenAI chat completions shape.

Example:
```json
{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "hello"}
  ],
  "stream": false
}
```

### Expected Router Behavior
1. Validate API key
2. Resolve workspace
3. Load active preset
4. Pick provider step
5. Forward request
6. Return translated response
7. Log usage

### Successful Response (non-streaming)
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  }
}
```

### Custom Response Headers
Router adds these headers to every response:

| Header | Description |
|--------|-------------|
| `X-NNR-Request-Id` | Unique request correlation ID |
| `X-NNR-Provider` | Provider type used (e.g. `codex`) |
| `X-NNR-Fallback-Hops` | Number of fallback attempts (0 if primary succeeded) |

### Provider Extensibility Rule
- provider type is resolved through a registry
- provider family and capabilities are metadata, not hardcoded logic
- adding a provider should ideally mean adding adapter + registry entry + config metadata

### Error Codes

> Full error code registry: see [`ERROR_CODES.md`](./ERROR_CODES.md)

---

## 3. Internal Contract Between Control Plane and Router
The control plane must provide the router with:
- workspace id
- active preset id
- provider connection metadata
- encrypted credential reference
- key status / revocation state

The router must return:
- request id
- provider used
- fallback path used
- token usage
- success/failure status
- minimal error code

---

## 4. Minimal Response Shapes

### Health
```json
{ "ok": true }
```

### Error
```json
{
  "error": {
    "code": "provider_unavailable",
    "message": "All providers failed"
  }
}
```

### Usage Event
```json
{
  "workspace_id": "uuid",
  "provider_connection_id": "uuid",
  "preset_id": "uuid",
  "request_id": "string",
  "status": "success",
  "total_tokens": 123
}
```
