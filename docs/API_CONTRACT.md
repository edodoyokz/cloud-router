# API Contract — NusaNexus Router MVP

## 1. Public Control-Plane APIs

These APIs are served by the web/control plane layer (Next.js on Vercel) and talk to Supabase.

### Auth Header (all control-plane APIs)
```
Cookie: sb-access-token=<supabase_jwt>
```
All control-plane APIs require an authenticated Supabase session. Unauthenticated requests return `401`.

---

### `GET /api/workspaces/current`
Returns the active workspace for the signed-in user.

**Response `200`**
```json
{
  "id": "uuid",
  "name": "My Workspace",
  "slug": "my-workspace",
  "created_at": "2026-01-01T00:00:00Z"
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
  "default_model": "gpt-4o-mini"
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
    "default_model": "gpt-4o-mini"
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

For the thin slice, provider creation ensures a default routing preset exists and appends the provider as a `failover` step.

**Errors:** `401` unauthorized, `400` validation error, `409` duplicate provider

---

### `DELETE /api/providers/:id`
Disconnects and removes a provider connection.

**Response `200`**
```json
{ "deleted": true }
```

**Errors:** `401` unauthorized, `404` not found

---

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

### `GET /api/usage`
Returns usage summary and recent events.

**Query Parameters**
- `period` — `today`, `7d`, `30d` (default: `today`)
- `limit` — max events to return (default: `50`)

**Response `200`**
```json
{
  "summary": {
    "total_requests": 142,
    "total_tokens": 58320,
    "success_rate": 0.96,
    "fallback_count": 5,
    "estimated_cost_usd": 0.45
  },
  "events": [
    {
      "id": "uuid",
      "provider_type": "codex",
      "model_resolved": "gpt-4o",
      "total_tokens": 450,
      "status": "success",
      "created_at": "2026-01-01T12:30:00Z"
    }
  ]
}
```

**Errors:** `401` unauthorized

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
