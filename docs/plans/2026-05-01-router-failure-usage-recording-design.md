# Router Failure Usage Recording Design

## Goal

Improve the usefulness of the NusaNexus Router dashboard Error Explanation Panel by recording authenticated router failures as `usage_events`.

The router should record failures only when the request can be safely associated with a workspace and router API key. This keeps tenant usage accurate and avoids schema changes for unauthenticated probes.

## Scope

Record failures after router API key resolution succeeds.

Do not record:

- missing API key
- invalid API key
- malformed auth header before workspace resolution
- prompt text
- completion text
- full request body
- provider response body
- provider API key
- raw router API key
- decrypted credentials

## Recommended Approach

Add minimal failure usage event recording inside `services/router/internal/httpserver/server.go`.

Each recorded failure event uses:

- `status = "failed"`
- `error_code = <structured router error code>`
- `workspace_id` from the resolved API key
- `api_key_id` from the resolved API key
- `provider_connection_id` when a preset/provider attempt is known
- `model_requested` when the parsed request included a model
- `model_resolved` when provider/default-model resolution has happened
- token counts set to zero

No database schema change, control-plane API change, or dashboard API change is required.

## Failure Paths

### Default preset missing

When the API key is valid but no default preset steps exist, return the existing `404 preset_not_found` response and record a failed usage event with `error_code = "preset_not_found"`.

### Provider missing or unavailable

When a preset step references an unavailable provider, return the existing `404 provider_not_found` response and record a failed usage event with the attempted `provider_connection_id`.

### Unsupported provider type

When a provider in the fallback chain is not `openai_compatible`, return the existing `502 provider_request_failed` response and record a failed usage event.

### Invalid provider metadata

When required provider metadata such as `base_url` or `default_model` is missing, return the existing `502 provider_request_failed` response and record a failed usage event.

### Provider credential failures

When provider credentials cannot be decrypted, parsed, or read, return the existing `502 provider_credential_missing` response and record a failed usage event.

### Authenticated invalid request payload failures

If an invalid request payload is detected after API key resolution, record a failed event with `error_code = "invalid_request"`.

### Fallback exhausted

When all fallback attempts fail due to retryable provider HTTP status codes or transport errors, return the existing `502 fallback_exhausted` response and record a failed usage event.

Use the final attempted provider ID and the best available requested/resolved model fields.

### Non-retryable provider HTTP failures

When a provider returns a non-retryable HTTP error, keep forwarding the provider response status/body as today, but also record a failed usage event with `error_code = "provider_request_failed"`.

The provider response body must not be stored.

## Privacy and Security

Failure usage events are structured operational metadata only. They must not store sensitive payloads or credentials.

Unauthenticated failures remain response-only because `usage_events.workspace_id` is required and the request cannot be attributed to a workspace safely.

## Testing

Add or update Go tests for:

1. `preset_not_found` records a failed usage event.
2. `fallback_exhausted` records a failed usage event with `fallback_exhausted`.
3. non-retryable provider HTTP error records `provider_request_failed`.
4. invalid API key still does not record a usage event.

Run:

```bash
cd services/router && go test ./...
npm run lint:web
npm run build:web
node --test apps/web/lib/error-explanations.test.js
node --test apps/web/lib/provider-routing-suggestions.test.js
```

## Documentation

Update:

- `README.md`
- `docs/API_CONTRACT.md`
- `docs/DB_SCHEMA.md`
- `docs/BACKLOG.md`
- `docs/SETUP.md`

Document that authenticated router failures are usage events with zero token counts, while unauthenticated invalid-key failures are not recorded in `usage_events`.
