# NusaNexus Router — Supabase Persistence Thin Slice Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router now has an in-memory/testable vertical slice for non-streaming OpenAI-compatible routing. The next step is to wire the same flow to Supabase so configuration created by the control plane can be consumed by the router data plane.

This design intentionally keeps the slice thin. It does not build a full dashboard UI or full production auth UI yet. It provides server-side persistence primitives and a dev-friendly workspace fallback so the end-to-end data flow can be validated early.

## Goals

- Persist OpenAI-compatible provider connections from Next.js API routes into Supabase.
- Generate NusaNexus API keys, store only hashes, and return raw keys once.
- Ensure a default routing preset exists and attach provider steps automatically.
- Let the Go router validate API keys and resolve routing config from Supabase.
- Let the Go router write usage events and update API key `last_used_at`.
- Keep local development usable via `DEV_WORKSPACE_ID` until full auth UI/session handling is implemented.

## Non-Goals

- Full login/signup UI.
- Complete dashboard screens.
- Supabase RLS policy design.
- Billing, teams, or org RBAC.
- Streaming support.
- Embeddings support.
- Provider health checks.
- Provider OAuth.

## Recommended Approach

Use a **full vertical thin slice**:

1. Control-plane API routes write provider and API-key config to Supabase.
2. Router data-plane reads API keys, default preset steps, provider connections, and writes usage events through Supabase REST/PostgREST.
3. Auth resolution uses a production-shaped helper with a dev fallback: `DEV_WORKSPACE_ID`.

This approach proves the actual data flow without waiting for the full dashboard/auth experience.

## Environment Variables

### Web/control plane

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=
DEV_WORKSPACE_ID=
```

### Router/data plane

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=
ROUTER_PORT=8080
REQUEST_TIMEOUT_MS=30000
MAX_FALLBACK_HOPS=3
```

`DEV_WORKSPACE_ID` is only for local/dev control-plane routes while full Supabase Auth session handling is not implemented. It should not be required in production once auth/workspace resolution is complete.

## Control-Plane Components

### Supabase admin helper

Create a server-only helper for API routes:

```text
apps/web/lib/supabase-admin.js
```

Responsibilities:

- Read `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Create server-side Supabase/PostgREST access helpers.
- Never expose service role key to client-side code.
- Fail clearly when env is missing.

A lightweight REST helper is acceptable for this slice to avoid adding more abstractions than needed.

### Workspace resolver

Create:

```text
apps/web/lib/workspace.js
```

Initial behavior:

1. Future path: resolve workspace from Supabase Auth user session.
2. Current thin slice path: if `DEV_WORKSPACE_ID` is set, return it.
3. If no workspace can be resolved, return an auth/workspace error.

This keeps the API routes production-shaped while remaining testable locally.

### Provider persistence

Update:

```text
apps/web/app/api/providers/route.js
```

`POST /api/providers` should:

1. Parse and validate provider input.
2. Resolve workspace.
3. Encrypt the provider API key using `ENCRYPTION_KEY`.
4. Insert into `provider_connections`:
   - `workspace_id`
   - `provider_type = openai_compatible`
   - `display_name`
   - `auth_method = api_key`
   - `provider_family = openai_compatible`
   - `capabilities`
   - `metadata`
   - `credential_encrypted`
   - `status = active`
   - `quota_state = {}`
5. Ensure a default routing preset exists.
6. Add a routing preset step for the new provider.
7. Return the provider record without any credential material.

Recommended `metadata`:

```json
{
  "base_url": "https://api.example.com",
  "default_model": "gpt-4o-mini"
}
```

Recommended `capabilities`:

```json
{
  "chat_completions": true,
  "model_selection": true,
  "fallback": true
}
```

## API Key Generation

Create:

```text
apps/web/app/api/endpoint/keys/route.js
```

`POST /api/endpoint/keys` should:

1. Resolve workspace.
2. Generate a random raw key with prefix `nnr_`.
3. Hash the full key with SHA-256.
4. Store:
   - `workspace_id`
   - `name`
   - `key_hash`
   - `prefix`
5. Return the raw key exactly once.

Example response:

```json
{
  "id": "uuid",
  "name": "Claude Code laptop",
  "prefix": "nnr_a1b2",
  "raw_key": "nnr_a1b2...",
  "created_at": "2026-05-01T00:00:00Z"
}
```

## Default Preset Behavior

For the thin slice, provider creation should automatically ensure a default preset:

- If no default preset exists for the workspace, create one:
  - `name = Default`
  - `description = Default routing preset`
  - `is_default = true`
- Add a preset step pointing to the created provider:
  - `order_index = current max + 1`
  - `fallback_mode = failover`

This keeps the first provider immediately usable by the router without requiring a separate preset UI.

## Router Supabase Repository

Create a repository implementation:

```text
services/router/internal/store/supabase.go
```

It should implement the existing `store.Repository` interface:

```go
FindAPIKeyByHash(ctx, hash)
DefaultPresetSteps(ctx, workspaceID)
ProviderConnection(ctx, workspaceID, providerConnectionID)
RecordUsage(ctx, event)
```

It should also update `api_keys.last_used_at` when an API key is successfully validated, either inside `FindAPIKeyByHash` or through a small internal helper.

Use Supabase REST/PostgREST via `net/http` for this slice.

Required headers:

```http
apikey: <SUPABASE_SERVICE_ROLE_KEY>
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
```

Example query patterns:

```text
GET /rest/v1/api_keys?key_hash=eq.<hash>&revoked_at=is.null&select=*
PATCH /rest/v1/api_keys?id=eq.<id>
GET /rest/v1/routing_presets?workspace_id=eq.<workspace_id>&is_default=eq.true&select=id
GET /rest/v1/routing_preset_steps?preset_id=eq.<preset_id>&order=order_index.asc&select=*
GET /rest/v1/provider_connections?id=eq.<id>&workspace_id=eq.<workspace_id>&select=*
POST /rest/v1/usage_events
```

## Router Repository Selection

Update `services/router/main.go` so startup selects:

- Supabase repository if `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present.
- Memory repository otherwise.

This preserves the current unit tests and local simple mode.

## Error Handling

Control-plane API routes should return:

- `400 validation_error` for invalid input.
- `401 workspace_not_resolved` when no workspace can be resolved.
- `500 persistence_error` for Supabase write failures.
- Never return raw provider API keys.

Router repository should:

- Treat missing rows as not found, not fatal errors.
- Return fatal errors for malformed Supabase responses or non-2xx responses.
- Avoid logging secrets.

## Testing Strategy

### Web/control-plane

- Unit-test provider input validation.
- Unit-test crypto helper if implemented in JS.
- Use mocked/fake fetch for Supabase helper behavior if practical.
- Build and lint:

```bash
npm run build:web
npm run lint:web
```

### Router/data-plane

- Test Supabase repository against `httptest.Server`.
- Cover:
  - API key lookup success.
  - API key lookup not found.
  - default preset step ordering.
  - provider connection decode from JSON metadata.
  - usage event POST body.
- Existing router tests must still pass:

```bash
cd services/router && go test ./...
```

## Acceptance Criteria

The batch is complete when:

- `POST /api/providers` persists a provider connection in Supabase-compatible shape.
- Provider creation ensures a default preset and preset step.
- `POST /api/endpoint/keys` persists a hashed API key and returns the raw key once.
- Go router can use Supabase repository when configured.
- Go router still works with memory repository in tests.
- Usage events are posted to Supabase repository.
- `go test ./...`, `npm run build:web`, and `npm run lint:web` pass.
