# NusaNexus Router — OpenAI-Compatible Provider Design

Date: 2026-05-01
Status: Approved

## Context

This repository will be branded as **NusaNexus Router**. Avoid using the old product name in new work, documentation, UI copy, API examples, and generated snippets.

The first implementation slice should support a single generic OpenAI-compatible provider using API-key authentication. This lets the product prove the core router flow without provider-specific OAuth complexity.

## Goals

- Rebrand product-facing references to **NusaNexus Router**.
- Support a generic OpenAI-compatible provider.
- Let users configure a provider with base URL, API key, and default model.
- Support `POST /v1/chat/completions` non-streaming only for the first slice.
- Build the smallest useful vertical slice across dashboard, data model, API key auth, router forwarding, and usage logging.

## Non-Goals

- Streaming SSE support.
- Embeddings support.
- Provider OAuth flows.
- Provider-specific presets such as OpenAI, OpenRouter, Together, Groq, or local runtimes.
- Advanced analytics, billing, teams, or marketplace features.

## Recommended Approach

Use a **generic OpenAI-compatible provider** model.

A provider connection stores:

- display name
- provider type: `openai_compatible`
- auth method: `api_key`
- provider family: `openai_compatible`
- non-secret metadata: base URL and default model
- encrypted credential: provider API key
- status and capabilities

This approach is flexible enough for many OpenAI-compatible backends while keeping the MVP implementation small.

## Provider Data Model

The provider connection should represent this shape:

```text
provider_connections
- id
- workspace_id
- provider_type: openai_compatible
- display_name
- auth_method: api_key
- provider_family: openai_compatible
- capabilities: jsonb
- metadata: jsonb
- credential_encrypted
- status
- quota_state
- last_checked_at
- created_at
- updated_at
```

Recommended `metadata` shape:

```json
{
  "base_url": "https://api.example.com",
  "default_model": "gpt-4o-mini"
}
```

Recommended encrypted credential plaintext before encryption:

```json
{
  "api_key": "sk-..."
}
```

`base_url` and `default_model` are not secrets, so they should live in metadata rather than inside the encrypted blob. The provider API key must never be returned to the browser after create/update.

## Control-Plane API

Provider creation should accept:

```json
{
  "provider_type": "openai_compatible",
  "display_name": "My Provider",
  "auth_method": "api_key",
  "base_url": "https://api.example.com",
  "api_key": "sk-...",
  "default_model": "gpt-4o-mini"
}
```

Server behavior:

1. Validate authenticated session.
2. Resolve current workspace.
3. Validate and normalize `base_url`.
4. Validate `api_key` and `default_model` are present.
5. Encrypt the provider API key.
6. Store non-secret provider config in `metadata`.
7. Store provider capabilities in `capabilities`.
8. Insert provider connection with `status = active`.

For the first vertical slice, provider health checks may be skipped. The system can add `/v1/models` validation later.

## Router Behavior

The router exposes:

```http
POST /v1/chat/completions
Authorization: Bearer <nusanexus-api-key>
Content-Type: application/json
```

Request flow:

1. Validate the NusaNexus API key.
2. Resolve workspace.
3. Resolve default routing preset.
4. Load the first provider step.
5. Load provider metadata and decrypt provider API key.
6. Determine target model:
   - use request `model` when present and not `auto`
   - use provider `default_model` when request model is empty or `auto`
7. Forward the request body to:

```text
{base_url}/v1/chat/completions
```

8. Use provider authorization:

```http
Authorization: Bearer <provider-api-key>
```

9. Return the provider response body and status code.
10. Write a basic usage event.

## Streaming Handling

Streaming is not supported in the first slice.

If the request body contains:

```json
{ "stream": true }
```

Return:

```http
400 Bad Request
```

with error code:

```text
unsupported_streaming
```

## Fallback Behavior

Fallback should be structurally supported but minimal.

Initial behavior:

- Try provider steps in preset order.
- Retry the next step only for transient/provider-side failures: `429`, `500`, `502`, `503`, `504`, and timeout.
- If all providers fail, return `fallback_exhausted`.
- If there is only one provider, return the provider failure with normalized error metadata.

## Error Codes

Minimum error codes for this slice:

- `invalid_api_key`
- `workspace_not_found`
- `preset_not_found`
- `provider_not_found`
- `provider_credential_missing`
- `provider_request_failed`
- `provider_timeout`
- `fallback_exhausted`
- `unsupported_streaming`

## Testing Strategy

Minimum test coverage:

- Database schema supports provider metadata and capabilities.
- Provider creation validates base URL, API key, and default model.
- Provider API key is encrypted before storage.
- NusaNexus API keys are stored hashed and raw keys are only shown once.
- Router rejects invalid NusaNexus API keys.
- Router rejects `stream: true` with `unsupported_streaming`.
- Router maps `model: auto` to provider default model.
- Router forwards non-streaming chat completion to a mock OpenAI-compatible server.
- Router records usage event after successful request.
- Router attempts next provider step on transient failure when fallback steps exist.

## Rebranding Rules

Implementation should update product-facing references from the old name to **NusaNexus Router** across:

- README and docs
- landing page copy
- package metadata where user-facing
- API examples and config snippets
- dashboard UI text
- generated API key/snippet labels if applicable

Do not change unrelated internal identifiers unless needed for clarity or correctness. Prefer incremental, low-risk renaming over broad filesystem moves unless the implementation plan explicitly calls for them.

## Approved Direction

The approved first build slice is:

1. Rebrand product-facing text to **NusaNexus Router**.
2. Add generic OpenAI-compatible provider support using base URL, API key, and default model.
3. Implement non-streaming `/v1/chat/completions` forwarding.
4. Add minimal API key validation, preset resolution, fallback structure, and usage logging.
5. Defer streaming, embeddings, OAuth, and provider preset registry.
