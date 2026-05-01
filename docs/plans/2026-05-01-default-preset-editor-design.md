# NusaNexus Router — Default Preset / Fallback Chain Editor Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router currently supports the core hosted-router MVP loop:

- Supabase Auth login/signup with hybrid workspace auto-create.
- OpenAI-compatible provider connection with encrypted API-key credentials.
- Router API key generation/revocation.
- Non-streaming `/v1/chat/completions` forwarding through the Go router.
- Supabase-backed usage logging and dashboard usage display.
- Provider management and provider health checks.

Provider creation currently ensures a default routing preset exists and appends the provider as a failover step. However, users cannot inspect or control the default fallback chain from the dashboard.

This slice adds a focused editor for the **default preset only**, allowing users to configure the fallback chain used by the router.

## Goals

- Add API endpoints for reading and replacing the active workspace's default preset chain.
- Add dashboard UI for editing the default fallback chain.
- Support adding providers to the chain.
- Support removing providers from the chain.
- Support reordering providers up/down.
- Support optional per-step `model_alias` overrides.
- Preserve `fallback_mode = "failover"` for all steps in this MVP.
- Avoid full multi-preset CRUD complexity.

## Non-Goals

- Multiple preset creation/listing/deletion UI.
- Selecting active/default preset among many presets.
- Drag-and-drop reordering.
- Round-robin/sticky routing UI.
- Provider tags/pricing-aware routing.
- Advanced condition-based routing.
- Schema migrations.

## Scope Decision

Build a **default fallback chain editor** only.

The router already reads the default preset. Editing that one preset provides direct product value and satisfies the MVP path without creating extra concepts for the user.

## API Design

### `GET /api/presets/default`

Returns the active workspace's default routing preset and enriched steps.

Request:

```http
GET /api/presets/default
Authorization: Bearer <supabase_access_token>
```

Response:

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
      "display_name": "OpenAI",
      "status": "active",
      "health": "healthy",
      "model_alias": null,
      "fallback_mode": "failover"
    }
  ]
}
```

Behavior:

1. Resolve workspace using the existing hybrid resolver.
2. Ensure default preset exists if missing.
3. Load `routing_preset_steps` ordered by `order_index.asc`.
4. Enrich steps with safe provider fields from `provider_connections`.
5. Return safe preset data only.

### `PUT /api/presets/default`

Replaces the default fallback chain.

Request:

```json
{
  "steps": [
    {
      "provider_connection_id": "uuid",
      "model_alias": null
    },
    {
      "provider_connection_id": "uuid",
      "model_alias": "gpt-4o-mini"
    }
  ]
}
```

Response:

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
      "display_name": "OpenAI",
      "status": "active",
      "health": "healthy",
      "model_alias": null,
      "fallback_mode": "failover"
    }
  ]
}
```

Behavior:

1. Resolve workspace.
2. Ensure default preset exists.
3. Validate request body.
4. Validate every provider belongs to the workspace.
5. Reject disconnected providers.
6. Reject duplicate provider IDs.
7. Delete existing default preset steps.
8. Insert replacement steps with sequential `order_index`, starting at 1.
9. Set every `fallback_mode` to `failover` server-side.
10. Return updated default preset.

## Validation Rules

- `steps` must be an array.
- Max 10 steps for MVP.
- Each step requires `provider_connection_id`.
- Provider IDs must be unique.
- Provider IDs must belong to the active workspace.
- Providers with `status = disconnected` are rejected.
- Providers with `status = error` are allowed but should display warning/health state in UI.
- `model_alias` is optional.
- If present, `model_alias` must be a string max 128 characters after trim.
- Empty model aliases normalize to `null`.
- `fallback_mode` is always `failover` and ignored from client input.

## Supabase Helper Requirement

Current admin helper supports select/insert/patch. This slice needs delete:

```text
apps/web/lib/supabase-admin.js
```

Add:

```js
export async function supabaseDelete(table, query) {}
```

Use it for:

```http
DELETE /rest/v1/routing_preset_steps?preset_id=eq.<preset_id>
```

## Preset Helper Module

Create:

```text
apps/web/lib/presets.js
```

Responsibilities:

- Ensure default preset exists.
- Load default preset with enriched steps.
- Normalize/validate replacement step input.
- Replace default preset steps.

Suggested exports:

```js
export async function ensureDefaultPreset(workspaceId) {}
export async function getDefaultPresetWithSteps(workspaceId) {}
export function normalizePresetStepInput(steps) {}
export async function replaceDefaultPresetSteps(workspaceId, rawSteps) {}
```

This keeps API route files small and avoids duplicating default-preset creation logic.

Provider creation currently has local `ensureDefaultPreset` / `appendPresetStep` helpers in `apps/web/app/api/providers/route.js`. These can remain for this slice, or be refactored to shared helpers if straightforward. Avoid risky refactors unless simple.

## Dashboard UX

Add a new section:

```text
Default fallback chain
```

### Data State

Add independent state so preset errors do not break provider/API key/usage sections:

- `preset`
- `presetDraftSteps`
- `presetStatus`
- `loadingPreset`
- `savingPreset`
- `addPresetProviderId`
- `addPresetModelAlias`

### Load Behavior

Dashboard should load the preset on mount using:

```text
GET /api/presets/default
```

Because React lint rejects synchronous setState in effects, use the same async/cancelled pattern already used for resources and usage.

### Editing Behavior

Use local draft edits and one explicit save.

User actions:

- Move step up.
- Move step down.
- Remove step.
- Add selected provider.
- Edit optional model alias for a step.
- Save chain.
- Reset changes.

### Provider Selection

Add provider dropdown should include providers from the existing `providers` state not already in the draft chain.

Provider display should include status/health. Disconnected providers should not be addable.

### Chain Row Display

Each step row shows:

- Step number.
- Provider display name.
- Provider status.
- Provider health.
- Optional model alias input.
- Move up/down/remove buttons.

### Save Behavior

`Save chain` sends:

```json
{
  "steps": [
    {
      "provider_connection_id": "uuid",
      "model_alias": null
    }
  ]
}
```

After success:

- update `preset`
- update `presetDraftSteps`
- show success status

### Reset Behavior

`Reset changes` restores `presetDraftSteps` from `preset.steps`.

## Router Impact

No router change is required for this thin slice.

Expected current router behavior:

- Loads default preset steps ordered by `order_index.asc`.
- Uses `fallback_mode = failover`.
- Provider lookup only returns active providers.
- Disconnected/error providers are not used by the router due to provider lookup filtering.

If a user saves an `error` provider in the chain, the dashboard should show that state. Router behavior remains conservative by only using active providers.

## Security Constraints

- Always scope preset and provider queries by `workspace_id`.
- Do not return provider credentials.
- Do not return API key hashes/raw keys.
- Validate provider ownership before inserting preset steps.
- Use service-role Supabase calls only server-side.

## Testing Strategy

Required verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual smoke test with Supabase configured:

1. Log in.
2. Connect two providers.
3. Open dashboard.
4. Confirm default fallback chain appears.
5. Reorder providers and save.
6. Refresh page and confirm order persists.
7. Remove a provider and save.
8. Add it back with optional model alias and save.
9. Send router request and confirm default preset still routes.

## Acceptance Criteria

This slice is complete when:

- `GET /api/presets/default` exists.
- `PUT /api/presets/default` exists.
- API creates default preset if missing.
- API returns enriched, safe step data.
- API validates replacement chains.
- API rejects disconnected providers.
- API replaces steps with sequential order.
- Dashboard displays current default fallback chain.
- Dashboard supports add/remove/reorder/model alias draft edits.
- Dashboard saves and resets chain changes.
- Web lint/build pass.
- Go tests pass.
