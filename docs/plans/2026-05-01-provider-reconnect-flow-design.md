# NusaNexus Router — Provider Reconnect Flow Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router supports provider connection, provider health checks, provider disconnect, and default fallback chain editing.

Current provider lifecycle:

- `POST /api/providers` creates a new OpenAI-compatible API-key provider.
- `GET /api/providers` lists safe provider fields.
- `POST /api/providers/[id]/check` runs a real tiny chat completion probe.
- `DELETE /api/providers/[id]` soft-disconnects a provider via `status = 'disconnected'`.
- Health checks reject disconnected providers.
- Router only uses active providers.

Missing lifecycle operation:

- Reconnect an existing disconnected/error/expired provider.
- Rotate credentials for an active provider.
- Update provider base URL/default model without creating duplicates.

This slice adds a provider reconnect/credential rotation flow while preserving credential secrecy.

## Goals

- Add `PATCH /api/providers/[id]` for reconnect/update.
- Update existing provider credential, metadata, and display name.
- Set provider back to `active`.
- Clear stale health state after reconnect.
- Add dashboard inline reconnect form per provider.
- Keep provider health check manual after reconnect.
- Never return old or new credential material.

## Non-Goals

- Auto health check after reconnect.
- Background provider verification.
- Provider OAuth.
- Provider secrets history.
- Partial credential-free metadata edit.
- Multi-provider bulk reconnect.
- Pricing/model catalog configuration.

## API Design

### `PATCH /api/providers/[id]`

Reconnects or rotates an existing OpenAI-compatible API-key provider.

Request:

```http
PATCH /api/providers/{id}
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

Body:

```json
{
  "display_name": "OpenAI production",
  "base_url": "https://api.openai.com",
  "default_model": "gpt-4o-mini",
  "api_key": "sk-new"
}
```

Validation:

- `id` required.
- Provider must exist in active workspace.
- Provider must be `provider_type = openai_compatible`.
- Provider must be `auth_method = api_key`.
- `display_name` required and trimmed.
- `base_url` required, trimmed, trailing slash removed, must start with `http://` or `https://`.
- `default_model` required and trimmed.
- `api_key` required and trimmed.

Patch behavior:

```text
display_name = input.display_name
metadata = { base_url, default_model }
credential_encrypted = encrypt({ api_key })
status = active
quota_state = {}
last_checked_at = null
```

Response `200`:

```json
{
  "id": "uuid",
  "provider_type": "openai_compatible",
  "display_name": "OpenAI production",
  "auth_method": "api_key",
  "status": "active",
  "metadata": {
    "base_url": "https://api.openai.com",
    "default_model": "gpt-4o-mini"
  },
  "quota_state": {},
  "last_checked_at": null,
  "created_at": "2026-05-01T00:00:00.000Z"
}
```

Errors:

- `400 validation_error`
- `404 not_found`
- `500 configuration_error`
- `500 persistence_error`

## Dashboard UX

Provider card gets a new button:

```text
Reconnect / rotate key
```

Clicking it opens an inline form in that provider card:

- Provider name
- Base URL
- Default model
- New provider API key
- Save reconnect
- Cancel

Initial form values:

- `display_name` from provider row.
- `base_url` from `provider.metadata.base_url`.
- `default_model` from `provider.metadata.default_model`.
- `api_key` empty.

After successful reconnect:

- API key input is cleared.
- Inline form closes.
- Provider list reloads.
- Dashboard status message:

```text
Provider reconnected. Run health check to verify.
```

Health check remains manual to avoid unexpected provider cost.

## Security Constraints

- `GET /api/providers` still must not return `credential_encrypted`.
- `PATCH /api/providers/[id]` response must not return `credential_encrypted`.
- Existing credential is never decrypted or shown.
- New credential is encrypted before storage.
- Patch must filter by `workspace_id`.
- Reconnect must not create a duplicate provider.

## Router Behavior

No Go router changes expected.

Router already uses only active providers via Supabase query:

```text
status=eq.active
```

After reconnect sets `status = active`, router can use the provider again.

## Preset Behavior

No preset changes expected.

If a disconnected provider remains in the default fallback chain, reconnecting it should make that existing step usable again because provider ID is unchanged.

## Testing Strategy

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual smoke test:

1. Connect provider.
2. Disconnect provider.
3. Confirm health check is unavailable for disconnected provider.
4. Open reconnect form.
5. Submit new base URL/default model/API key.
6. Confirm status becomes `active`.
7. Click health check manually.
8. Confirm provider health updates.
9. Confirm default fallback chain can still use the same provider ID.

## Acceptance Criteria

- `PATCH /api/providers/[id]` exists.
- Reconnect works for disconnected/error/expired/active providers.
- Provider is updated in-place and set to `active`.
- Provider credential is replaced encrypted.
- Stale health fields are cleared.
- Dashboard inline reconnect form works.
- Existing disconnect and health check flows still work.
- Credentials are never returned by API responses.
- Lint/build/tests pass.
