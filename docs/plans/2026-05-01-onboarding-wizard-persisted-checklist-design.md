# Onboarding Wizard Persisted Checklist Design

Date: 2026-05-01
Status: Approved

## Goal

Add a better onboarding wizard to NusaNexus Router that helps a new workspace reach first value: connect a provider, verify it, generate a router key, copy a client snippet, and send the first request.

The wizard must be persisted at workspace scope and must not block normal dashboard use.

## Scope

The dashboard will show a Quick start card with five activation steps:

1. Connect a provider
2. Run a provider health check
3. Generate a router API key
4. Copy a client snippet
5. Send the first successful router request

The checklist is partly derived from existing workspace resources and partly persisted for user-only actions.

## Data Model

Add workspace metadata:

```sql
alter table workspaces
add column if not exists metadata jsonb not null default '{}'::jsonb;
```

Store onboarding state under `workspaces.metadata.onboarding`:

```json
{
  "dismissed": false,
  "completed_steps": ["copy_client_snippet"],
  "updated_at": "2026-05-01T00:00:00.000Z"
}
```

Only explicit user actions are persisted. Resource-backed steps are derived from source-of-truth tables:

- `connect_provider`: at least one non-disconnected provider exists
- `check_provider_health`: at least one provider has `quota_state.health = healthy`
- `generate_router_key`: at least one non-revoked router API key exists
- `copy_client_snippet`: persisted explicit step
- `send_first_request`: at least one usage event exists

This avoids stale duplicated progress and keeps onboarding tied to actual workspace state.

## API

Add:

```text
GET /api/onboarding
PATCH /api/onboarding
```

### GET /api/onboarding

Returns derived and persisted state:

```json
{
  "dismissed": false,
  "steps": [
    {
      "id": "connect_provider",
      "label": "Connect a provider",
      "complete": true,
      "source": "derived"
    },
    {
      "id": "check_provider_health",
      "label": "Run a provider health check",
      "complete": true,
      "source": "derived"
    },
    {
      "id": "generate_router_key",
      "label": "Generate a router API key",
      "complete": true,
      "source": "derived"
    },
    {
      "id": "copy_client_snippet",
      "label": "Copy a client snippet",
      "complete": false,
      "source": "persisted"
    },
    {
      "id": "send_first_request",
      "label": "Send your first request",
      "complete": false,
      "source": "derived"
    }
  ],
  "completed_count": 3,
  "total_count": 5
}
```

### PATCH /api/onboarding

Updates explicit persisted onboarding state:

```json
{
  "completed_steps": ["copy_client_snippet"],
  "dismissed": false
}
```

Validation rules:

- Only known persisted step IDs are accepted in `completed_steps`.
- Derived steps cannot be marked complete by the client.
- Unknown step IDs return a validation error.
- Auth/workspace resolution follows existing dashboard API behavior.

## Dashboard UX

Add a top-level dashboard card named **Quick start**.

The card shows:

- progress count, for example `3 / 5 complete`
- progress bar
- checklist rows
- per-step CTA buttons that jump to existing dashboard sections
- a dismiss button that persists `dismissed: true`
- a compact restore button when dismissed

Step CTAs:

- Connect provider: scroll to Connect provider section
- Run health check: scroll to Connected providers section
- Generate key: scroll to Generate router API key section
- Copy snippet: scroll to Endpoint config and copy the first useful snippet
- Send first request: scroll to Endpoint config / Usage guidance

The wizard is a guide, not a modal tour and not a blocker.

## Error Handling

- Dashboard still works if onboarding API fails.
- Wizard shows a small retryable warning if loading fails.
- Copying a snippet should still copy even if persisting checklist progress fails.
- If an existing database does not have `workspaces.metadata`, API errors should be clear enough to point to schema setup/update.

## Documentation

Update:

- `docs/schema.sql`
- `docs/DB_SCHEMA.md`
- `docs/API_CONTRACT.md`
- `docs/SETUP.md`
- `docs/BACKLOG.md`
- `README.md`

## Verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual checks:

1. New workspace with no resources shows `0 / 5` complete.
2. Provider creation marks provider step complete after refresh/load.
3. Healthy provider check marks health step complete.
4. Existing or newly generated active API key marks key step complete.
5. Copy snippet marks snippet step persisted.
6. First usage event marks first request complete.
7. Dismiss wizard persists and reload hides it.
