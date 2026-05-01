# NusaNexus Router — Provider Health Checks Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router currently lets users:

- Sign up/log in through Supabase Auth.
- Auto-create a personal workspace.
- Connect generic OpenAI-compatible providers with encrypted API-key credentials.
- Generate and revoke router API keys.
- Send non-streaming `/v1/chat/completions` requests through the Go router.
- View usage summary and recent usage events.

The next MVP gap is provider confidence. A provider can be connected, but the dashboard does not verify whether its `base_url`, API key, and `default_model` actually work.

The existing schema already supports health state:

```sql
provider_connections.status
provider_connections.quota_state
provider_connections.last_checked_at
```

No schema migration is required for this thin slice.

## Decision

Use a **real chat completion probe** for provider health checks.

The probe calls the same provider capability the router currently supports:

```http
POST {base_url}/v1/chat/completions
```

with a tiny non-streaming request:

```json
{
  "model": "<default_model>",
  "messages": [
    { "role": "user", "content": "ping" }
  ],
  "max_tokens": 1,
  "stream": false
}
```

This may cost a tiny amount, but it validates the actual MVP path: chat completions with the configured model and credential.

## Goals

- Add a manual provider health check API.
- Show provider health in the dashboard.
- Update provider status/health metadata in Supabase.
- Keep provider credentials server-only.
- Use short timeout to avoid hung serverless requests.
- Avoid adding scheduler/background jobs in this slice.

## Non-Goals

- Scheduled/automatic health checks.
- Provider quota/rate-limit estimation.
- Rich latency metrics.
- Cost accounting for probe calls.
- Provider-specific health adapters beyond generic OpenAI-compatible chat completions.
- Reconnect/credential-rotation flow.
- New database migrations.

## API Design

### `POST /api/providers/:id/check`

Runs a health check for a provider connection in the active workspace.

Request:

```http
POST /api/providers/<provider_id>/check
Authorization: Bearer <supabase_access_token>
```

No request body is required.

### Success Response

When the probe succeeds:

```json
{
  "id": "uuid",
  "status": "active",
  "health": "healthy",
  "last_checked_at": "2026-05-01T00:00:00Z",
  "message": "Provider check passed"
}
```

### Unhealthy Provider Response

If the control-plane API successfully runs the check but the provider fails, return HTTP `200` with an unhealthy result:

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

Rationale: the API operation completed successfully; the checked resource is unhealthy.

### API Errors

Use HTTP errors only when the control-plane operation itself cannot run:

- `401` unauthorized / invalid session.
- `404` provider not found for workspace.
- `400` disconnected provider cannot be checked.
- `400` unsupported provider type/auth method.
- `500` missing encryption config, decrypt failure, Supabase failure, or unexpected server error.

## Provider Selection and Workspace Safety

The check route must:

1. Resolve workspace using existing hybrid resolver.
2. Select provider by both `id` and `workspace_id`.
3. Never check another workspace's provider.
4. Never return `credential_encrypted` or decrypted credentials.
5. Reject disconnected providers.

## Credential Decryption

Current web crypto helper can encrypt credentials. This slice adds decrypt support to:

```text
apps/web/lib/crypto.js
```

Expected functions:

```js
export async function decryptCredential(encrypted) {}
```

The encrypted format remains the existing AES-256-GCM payload:

```text
base64(iv || ciphertext || tag)
```

where:

- `iv`/nonce length is 12 bytes.
- `tag` length is 16 bytes.
- key material comes from `ENCRYPTION_KEY`.

Decryption must remain server-side only.

## Health Check Helper

Create server-side helper:

```text
apps/web/lib/provider-health.js
```

Expected responsibilities:

- Normalize provider base URL.
- Build `/v1/chat/completions` URL.
- Run OpenAI-compatible health probe.
- Enforce timeout.
- Convert provider/network failures into safe user-facing messages.

Suggested API:

```js
export function normalizeOpenAIBaseUrl(baseUrl) {}
export function buildChatCompletionsUrl(baseUrl) {}
export async function runOpenAICompatibleHealthCheck({ baseUrl, apiKey, model, fetchImpl = fetch, timeoutMs = 10000 }) {}
```

`runOpenAICompatibleHealthCheck` returns a structured result, not raw provider response:

```js
{
  ok: true,
  message: 'Provider check passed'
}
```

or:

```js
{
  ok: false,
  error_code: 'provider_check_failed',
  message: 'Provider returned 401'
}
```

## Supabase Updates

On success, patch `provider_connections` row:

```json
{
  "status": "active",
  "last_checked_at": "<now>",
  "quota_state": {
    "health": "healthy",
    "last_error_code": null,
    "last_error_message": null
  }
}
```

On unhealthy result, patch:

```json
{
  "status": "error",
  "last_checked_at": "<now>",
  "quota_state": {
    "health": "error",
    "last_error_code": "provider_check_failed",
    "last_error_message": "Provider returned 401"
  }
}
```

Existing `quota_state` may be overwritten for this MVP. Preserving unknown keys can be deferred unless trivial.

## Dashboard Design

In the existing Connected providers section, display:

- `status`
- `health`: `provider.quota_state?.health || 'unknown'`
- `last_checked_at`
- last error message if present
- button: `Check health`

Button behavior:

1. Call `POST /api/providers/:id/check`.
2. Show success/error message.
3. Refresh provider list.

The button should be disabled while checking and for disconnected providers.

## Status Semantics

- `active`: provider can be used by the router.
- `error`: last health check failed; router should not use it if provider lookup requires active providers.
- `disconnected`: user intentionally disconnected; cannot be checked until a reconnect flow exists.

The router already ignores non-active providers in the current management slice.

## Security Constraints

- Do not return encrypted or decrypted credentials.
- Do not log decrypted credentials.
- Do not include raw provider error bodies in API response; use short sanitized messages.
- Scope all provider lookups and patches by workspace.
- Health check route must run only server-side.

## Error Message Sanitization

Provider responses may contain sensitive details. For this MVP, messages should be generic:

- `Provider returned 401`
- `Provider returned 404`
- `Provider request timed out`
- `Provider request failed`
- `Provider returned an invalid response`

Avoid echoing full provider JSON bodies.

## Testing Strategy

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Helper verification can use Node import scripts for URL normalization and mocked health checks.

Manual smoke test with Supabase configured:

1. Log in.
2. Connect an OpenAI-compatible provider.
3. Click `Check health` in dashboard.
4. Confirm `health=healthy` for valid credentials.
5. Connect or modify a provider with invalid credentials/base URL.
6. Click `Check health` and confirm `status=error` with a safe message.

## Acceptance Criteria

This slice is complete when:

- `POST /api/providers/:id/check` exists.
- The route is workspace-scoped.
- The route rejects disconnected providers.
- The route decrypts credentials server-side only.
- The route runs a real non-streaming chat completion probe with `max_tokens: 1`.
- The route updates `status`, `quota_state.health`, error metadata, and `last_checked_at`.
- Dashboard shows provider health and last checked time.
- Dashboard can trigger health checks and refresh provider list.
- Web lint/build pass.
- Go tests pass.
