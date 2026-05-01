# Error Explanation Panel Design

Date: 2026-05-01
Status: Approved

## Goal

Help users understand and fix common NusaNexus Router failures from the dashboard without storing prompts, completions, provider response bodies, or sensitive credential material.

## MVP Focus

The MVP explains errors from existing dashboard data:

1. Usage recent events (`status`, `error_code`)
2. Provider health state (`quota_state.health`, sanitized `last_error_message`)

## Recommended Approach

Add a local/shared explanation helper and render compact dashboard explanation panels.

Create:

```text
apps/web/lib/error-explanations.js
```

The helper maps known error codes, statuses, and sanitized provider health messages to plain-language explanations and suggested next actions.

No new API, DB migration, or router behavior change is required.

## Why This Approach

- Fast and low-risk.
- Uses data already returned to the dashboard.
- Avoids sensitive payload logging.
- Does not store prompt text, completion text, provider response bodies, or credentials.
- Can be expanded over time as more error codes or failure metadata are recorded.

## Alternatives Considered

### Persist structured error details in usage events

Pros:

- More accurate diagnosis.
- Could include provider HTTP status and attempt count.

Cons:

- Requires schema migration.
- Requires careful sanitization.
- Higher risk of storing sensitive provider response content.

Not selected for MVP.

### Router returns rich troubleshooting payloads

Pros:

- Client tools receive richer error details.

Cons:

- Requires router changes.
- Could expose internal provider/config hints to API clients.
- Dashboard still needs explanations for historical events.

Not selected for this slice.

## Explanation Helper

Exports:

```js
explainUsageEvent(event)
explainProviderHealth(provider)
explainErrorCode(code, context)
```

Return shape:

```js
{
  severity: 'info' | 'warning' | 'error',
  title: 'Invalid router API key',
  explanation: 'The request did not include a valid NusaNexus Router API key.',
  likelyCause: 'The key was copied incorrectly, revoked, or sent to the wrong endpoint.',
  nextActions: [
    'Generate a new router API key in the dashboard.',
    'Update your client Authorization header.',
    'Confirm the request is sent to the NusaNexus Router base URL.'
  ]
}
```

## Known Error Code Coverage

Initial mappings cover known router/control-plane error codes:

| Code | Meaning |
|---|---|
| `invalid_api_key` | Missing, invalid, or revoked router API key |
| `unsupported_streaming` | Client sent `stream: true`; MVP supports non-streaming only |
| `preset_not_found` | No default preset/fallback chain configured |
| `provider_not_found` | Preset references unavailable provider |
| `provider_request_failed` | Provider type unsupported or provider returned request failure |
| `provider_credential_missing` | Provider credential cannot be decrypted/read |
| `fallback_exhausted` | All attempted providers failed/retried and exhausted |
| `validation_error` | Control-plane request validation failed |
| `persistence_error` | Supabase/admin persistence failure |
| unknown/null | Generic no-code/unknown failure |

Status mapping:

- `success`: no explanation panel by default
- `fallback`: warning explaining that the request succeeded after a prior provider failed
- `failed`: error explanation based on `error_code`

## Provider Health Explanations

For connected provider cards:

- `health === 'healthy'`: no panel by default, current health display is enough
- `health === 'unknown'`: explain that the user should run a health check
- `health === 'error'`: explain using sanitized `last_error_message`

Message heuristics for `health === 'error'`:

| Message hint | Explanation type |
|---|---|
| `401`, `403`, `unauthorized`, `forbidden` | Credential/auth issue |
| `404`, `not found` | Base URL or model endpoint issue |
| `429`, `rate limit`, `quota` | Quota/rate-limit issue |
| `timeout`, `network`, `fetch failed` | Network/base URL reachability issue |
| other | Generic provider health failure |

No API keys, credentials, prompts, completions, or raw response bodies are displayed.

## Dashboard UX

### Usage recent events

For each recent event that is not a clean success, show a compact explanation panel below the event fields.

Example:

```text
Why this happened
Fallback exhausted
All attempted providers failed or could not complete the request.

Likely cause
Every provider in the current fallback chain failed, timed out, or was rate-limited.

Try this
- Run health checks for providers in the default chain.
- Check provider credentials and quotas.
- Add a backup provider or reorder the fallback chain.
```

For `fallback` status:

```text
Request succeeded after fallback
The first provider failed, but another provider completed the request.
```

For clean `success` events, do not show an explanation panel by default.

### Connected providers

For provider cards with `health === 'error'` or `health === 'unknown'`, show a compact health explanation panel.

Example:

```text
Health explanation
Provider health is unknown. Run Check health to verify the base URL, API key, and model.
```

## API / Backend Scope

No API changes.

No DB changes.

No router behavior changes.

Known limitation: the current router may not record usage events for every possible final failure path yet. This panel explains what is present in usage events and provider health metadata. Improving router failure recording can be a future slice.

## Documentation

Update:

```text
README.md
docs/API_CONTRACT.md
docs/BACKLOG.md
docs/SETUP.md
```

Document that:

- The dashboard explains common usage/provider health errors.
- Explanations are derived from sanitized statuses, error codes, and health messages.
- No prompt/completion/provider response body is stored or displayed.

## Verification

Automated:

```bash
node --test apps/web/lib/error-explanations.test.js
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual:

1. View Usage with a `fallback` or `failed` event and confirm an explanation panel appears.
2. Confirm clean `success` events do not get noisy panels.
3. Set/run provider health so `health: error` with sanitized message appears and confirm explanation panel suggests auth/base URL/quota/network actions.
4. Confirm no credentials or request/response payloads are displayed.
