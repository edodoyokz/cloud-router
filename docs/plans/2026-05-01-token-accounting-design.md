# NusaNexus Router — Token Accounting Thin Slice Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router already records usage events for successful router requests, but token counts are currently placeholders:

```text
total_tokens = 0
```

The database schema already supports:

```text
prompt_tokens
completion_tokens
total_tokens
estimated_cost_usd
```

The OpenAI-compatible providers generally return token usage on successful non-streaming chat completions:

```json
{
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 34,
    "total_tokens": 46
  }
}
```

This slice extracts provider-returned usage fields and stores them in `usage_events`, then updates the usage API/dashboard to show prompt/completion/total token splits.

## Goals

- Parse token usage from successful OpenAI-compatible provider responses.
- Persist `prompt_tokens`, `completion_tokens`, and `total_tokens` in usage events.
- Keep safe fallback to zero if provider omits usage.
- Return token split fields from `GET /api/usage`.
- Summarize prompt/completion/total token counts in the usage dashboard.
- Add tests for responses with and without `usage`.

## Non-Goals

- Pricing/cost estimation.
- Provider/model price configuration.
- Streaming usage aggregation.
- Failed-attempt usage accounting.
- Request log expansion.
- Analytics charts/daily buckets.

## Router Behavior

For successful provider responses only:

1. Forward provider response body unchanged to the client.
2. Parse the body best-effort for:

```json
usage.prompt_tokens
usage.completion_tokens
usage.total_tokens
```

3. Store usage event with extracted values.
4. If any field is missing/non-numeric, normalize it to `0`.
5. If `total_tokens` is missing but prompt/completion are present, compute:

```text
total_tokens = prompt_tokens + completion_tokens
```

6. If response body is not valid JSON, keep token fields as zero and still record usage.

### Example

Provider response:

```json
{
  "id": "chatcmpl_123",
  "object": "chat.completion",
  "choices": [],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  }
}
```

Recorded usage event:

```text
prompt_tokens = 10
completion_tokens = 5
total_tokens = 15
```

## Store Contract

Extend `store.UsageEvent`:

```go
type UsageEvent struct {
  WorkspaceID          string
  ProviderConnectionID string
  APIKeyID             string
  RequestID            string
  ModelRequested       string
  ModelResolved        string
  Status               string
  ErrorCode            string
  PromptTokens         int
  CompletionTokens     int
  TotalTokens          int
}
```

`SupabaseRepository.RecordUsage` should write:

```text
prompt_tokens
completion_tokens
total_tokens
```

Memory repository should keep the fields for tests.

## Usage API Design

Update `GET /api/usage` to select:

```text
prompt_tokens,completion_tokens,total_tokens
```

Response events include:

```json
{
  "id": "uuid",
  "provider_connection_id": "uuid",
  "api_key_id": "uuid",
  "request_id": "req_1",
  "model_requested": "auto",
  "model_resolved": "gpt-4o-mini",
  "prompt_tokens": 10,
  "completion_tokens": 5,
  "total_tokens": 15,
  "status": "success",
  "error_code": null,
  "created_at": "..."
}
```

## Usage Summary Design

Current summary:

```json
{
  "total_requests": 12,
  "total_tokens": 1000,
  "success_rate": 1,
  "fallback_count": 0,
  "failed_count": 0,
  "estimated_cost_usd": 0
}
```

Add:

```json
{
  "prompt_tokens": 600,
  "completion_tokens": 400
}
```

Keep `total_tokens` for backwards compatibility.

## Dashboard Design

Usage section should show:

- Total requests
- Success rate
- Fallback count
- Failed count
- Total tokens
- Prompt tokens
- Completion tokens
- Estimated cost placeholder

Recent events should include token split:

```text
Tokens: 15 total / 10 prompt / 5 completion
```

If fields are missing from old rows, display `0`.

## Security / Privacy

- Do not store prompt or completion text.
- Do not store provider response bodies.
- Only store numeric usage metadata.
- Continue to avoid returning credentials/API key hashes.

## Testing Strategy

Go tests should cover:

1. Provider response with usage records token counts.
2. Provider response without usage records zero counts.
3. Provider response with prompt/completion but missing total computes total.

Web tests are not currently configured beyond lint/build. Validate JS helper behavior through lint/build and existing manual checks.

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

## Acceptance Criteria

- Router extracts usage token fields from successful provider responses.
- Router records token fields through repository contract.
- Supabase repository writes `prompt_tokens`, `completion_tokens`, and `total_tokens`.
- Memory repository stores token fields for tests.
- Usage API returns token split fields.
- Usage dashboard displays token split summary and per-event token details.
- Lint/build/tests pass.
