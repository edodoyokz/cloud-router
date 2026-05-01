# NusaNexus Router — Management UI/API Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router now has:

- Thin Supabase Auth login/signup with hybrid workspace auto-create.
- Minimal `/dashboard` for creating providers and router API keys.
- Supabase-backed provider/API-key persistence.
- Go router support for non-streaming OpenAI-compatible chat completions.

The dashboard can create resources but cannot list or manage them. This slice closes that loop by adding management APIs and dashboard sections for providers and API keys.

## Goals

- List provider connections for the active workspace.
- Soft-disconnect provider connections.
- List router API keys for the active workspace.
- Revoke router API keys.
- Update dashboard to show providers and keys.
- Refresh dashboard lists after create/disconnect/revoke actions.
- Keep all operations workspace-scoped through the existing hybrid workspace resolver.

## Non-Goals

- Editing provider connection details.
- Reconnecting disconnected providers.
- Hard-deleting provider/API-key records.
- Showing raw API keys after creation.
- Preset editor UI.
- Usage dashboard.
- Full table design system.
- Team/workspace switching.

## API Design

All APIs use the existing control-plane auth behavior:

```http
Authorization: Bearer <supabase_access_token>
```

When no bearer token is present, local/dev fallback through `DEV_WORKSPACE_ID` remains available.

### `GET /api/providers`

Returns provider connections scoped to the current workspace.

Response:

```json
[
  {
    "id": "uuid",
    "provider_type": "openai_compatible",
    "display_name": "OpenAI",
    "auth_method": "api_key",
    "status": "active",
    "metadata": {
      "base_url": "https://api.openai.com",
      "default_model": "gpt-4o-mini"
    },
    "created_at": "2026-05-01T00:00:00Z"
  }
]
```

Must not return `credential_encrypted`.

### `DELETE /api/providers/:id`

Soft-disconnects a provider for the current workspace.

Behavior:

- Resolve workspace.
- Patch `provider_connections` where `id` and `workspace_id` match.
- Set:

```json
{ "status": "disconnected" }
```

Response:

```json
{ "disconnected": true }
```

If no row matches, return 404.

### `GET /api/endpoint/keys`

Returns router API keys scoped to the current workspace.

Response:

```json
[
  {
    "id": "uuid",
    "name": "Claude Code laptop",
    "prefix": "nnr_abcd",
    "created_at": "2026-05-01T00:00:00Z",
    "last_used_at": null,
    "revoked_at": null
  }
]
```

Must not return `key_hash` or any raw key material.

### `DELETE /api/endpoint/keys/:id`

Revokes an API key for the current workspace.

Behavior:

- Resolve workspace.
- Patch `api_keys` where `id` and `workspace_id` match.
- Set `revoked_at` to the current timestamp.

Response:

```json
{ "revoked": true }
```

If no row matches, return 404.

## Router Hardening

The router already rejects revoked API keys by querying `revoked_at=is.null`.

This slice should also ensure disconnected providers are not used. Preferred implementation:

- In Supabase repository `ProviderConnection`, include `status=eq.active` in the PostgREST query.
- In the in-memory repository, return `false` for providers whose `Status` is not `active`.

This prevents a disconnected provider from being selected by a still-existing preset step.

## Dashboard Design

Update:

```text
apps/web/app/dashboard/dashboard-client.jsx
```

Add resource list state:

- `providers`
- `apiKeys`
- `managementStatus`
- loading/action-pending states

On mount:

- Fetch providers.
- Fetch API keys.

After create provider:

- Clear provider API key field.
- Refresh providers.

After generate key:

- Show raw key once.
- Refresh API keys.

### Connected Providers Section

Show one card/row per provider:

- Display name
- Status badge
- Provider type
- Base URL
- Default model
- Created at
- Disconnect button when status is not `disconnected`

### Router API Keys Section

Show one card/row per key:

- Name
- Prefix
- Created at
- Last used at
- Revoked status
- Revoke button when `revoked_at` is null

Raw key is only shown in the existing post-generation success block. It is never fetched from list APIs.

## Error Handling

API routes should return consistent error payloads:

```json
{
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

Expected codes:

- `workspace_not_resolved`
- `invalid_session`
- `not_found`
- `persistence_error`
- `validation_error`

Dashboard should:

- Show load/action errors without crashing.
- Disable action buttons while an action is pending.
- Keep create forms usable if list loading fails.

## Security Constraints

- Do not return provider credentials.
- Do not return API key hashes.
- Do not return raw API keys except immediately after generation.
- Scope every list/patch by `workspace_id`.
- Keep service role key server-side only.

## Testing Strategy

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Add or update Go tests for provider status hardening.

Manual smoke test with Supabase configured:

1. Log in.
2. Open `/dashboard`.
3. Create provider.
4. Confirm provider appears in list.
5. Disconnect provider.
6. Confirm status changes to `disconnected`.
7. Generate API key.
8. Confirm key appears in list without raw key/hash.
9. Revoke key.
10. Confirm `revoked_at` appears and router rejects the raw key after revocation.

## Acceptance Criteria

This slice is complete when:

- `GET /api/providers` returns safe provider records for the active workspace.
- `DELETE /api/providers/:id` soft-disconnects a workspace-scoped provider.
- `GET /api/endpoint/keys` returns safe API key records for the active workspace.
- `DELETE /api/endpoint/keys/:id` revokes a workspace-scoped API key.
- Dashboard lists providers and API keys.
- Dashboard can disconnect providers and revoke keys.
- Dashboard refreshes lists after create/disconnect/revoke.
- Router does not use disconnected providers.
- Web lint/build pass.
- Go tests pass.
