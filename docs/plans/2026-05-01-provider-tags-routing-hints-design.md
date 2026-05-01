# NusaNexus Router — Provider Tags Routing Hints Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router already lets users connect OpenAI-compatible providers, manage provider lifecycle, edit the default fallback chain, and view usage analytics. The dashboard does not yet let users mark provider intent such as primary, backup, free, or cheap.

Provider tags are useful before automated routing policy exists because they help users understand and maintain their fallback chain:

- Which provider should be first?
- Which provider is a backup?
- Which provider is intended to be low-cost?
- Which provider is free or quota-limited?

This slice adds provider tags as lightweight routing hints without changing router behavior.

## Goals

- Let users store tags on provider connections.
- Support fixed MVP tags:
  - `primary`
  - `backup`
  - `free`
  - `cheap`
- Show tags in provider management UI.
- Let users update tags independently from credential reconnect/rotation.
- Show tags in the default fallback-chain editor as visual hints.
- Preserve existing provider credential secrecy.
- Avoid DB/schema migration for MVP.

## Non-Goals

- No router behavior changes.
- No automatic fallback-chain ordering.
- No weighted routing.
- No tag-based routing policies.
- No provider marketplace/catalog.
- No usage analytics by tag.
- No custom user-defined tags.
- No new database tables or columns.

## Storage

Store tags in existing `provider_connections.metadata` JSON:

```json
{
  "base_url": "https://api.openai.com",
  "default_model": "gpt-4o-mini",
  "tags": ["primary", "cheap"]
}
```

Reasons:

- `metadata` already stores provider display configuration.
- Existing APIs already return `metadata` safely.
- No migration needed.
- Tags are hints, not relational entities yet.

## Tag Normalization

Allowed tags:

```js
['primary', 'backup', 'free', 'cheap']
```

Normalization rules:

- Input must be an array.
- Non-string values are ignored or rejected depending route context.
- Trim and lowercase strings.
- Drop unknown tags.
- Deduplicate while preserving allowed-tag order.
- Store as array.

Recommended helper:

```text
apps/web/lib/provider-tags.js
```

Exports:

```js
export const ALLOWED_PROVIDER_TAGS = ['primary', 'backup', 'free', 'cheap'];
export function normalizeProviderTags(value) {}
export function providerTagLabel(tag) {}
```

## API Design

### Provider Create

`POST /api/providers` may accept optional:

```json
{
  "tags": ["primary", "cheap"]
}
```

Stored in `metadata.tags`.

### Provider Reconnect

`PATCH /api/providers/:id` may accept optional `tags`, but if omitted the existing tags should be preserved.

Reconnect currently replaces `metadata` with `base_url` and `default_model`. This slice must avoid accidentally dropping existing `metadata.tags` during reconnect.

### Provider Tag Update

Add:

```http
PATCH /api/providers/:id/tags
```

Request:

```json
{
  "tags": ["backup", "free"]
}
```

Response `200`:

```json
{
  "id": "uuid",
  "provider_type": "openai_compatible",
  "display_name": "Backup provider",
  "auth_method": "api_key",
  "status": "active",
  "metadata": {
    "base_url": "https://api.example.com",
    "default_model": "gpt-4o-mini",
    "tags": ["backup", "free"]
  },
  "quota_state": {},
  "last_checked_at": null,
  "created_at": "2026-05-01T00:00:00Z"
}
```

Errors:

- `400 validation_error` for invalid provider id/request shape.
- `401` workspace/auth errors from existing resolver.
- `404 not_found` when provider does not belong to workspace.

Credential material must never be returned.

## Dashboard Design

### Provider Connection Form

Add optional tag checkboxes under provider configuration:

- Primary
- Backup
- Free
- Cheap

Tags submit with provider create.

### Provider List

For each provider row/card:

- Display tag chips.
- Show text when no tags: `No tags`.
- Add inline tag editor with four toggles and a `Save tags` button.
- Save tags calls `PATCH /api/providers/:id/tags`.
- After save, reload providers and preset data so fallback-chain hints stay fresh.

Use existing `pendingActionId` and `managementStatus` patterns.

### Reconnect Form

Reconnect should preserve tags if user does nothing. It may show tag toggles if straightforward, but not required. The dedicated tag editor is the primary UI.

### Fallback Chain Editor

Show provider tags next to provider names in:

- current draft chain rows
- add-provider select labels if practical

This helps users order primary/backup/free/cheap providers manually.

## Data Flow

1. User creates provider with optional tags.
2. `POST /api/providers` normalizes tags and stores `metadata.tags`.
3. Dashboard list shows tag chips from `provider.metadata.tags`.
4. User edits tags in provider row.
5. `PATCH /api/providers/:id/tags` loads provider, merges normalized tags into existing metadata, patches row.
6. Dashboard reloads providers and preset chain.
7. Fallback-chain editor displays tags as hints.

## Security and Privacy

- Provider credentials remain encrypted and never returned.
- Tag route only patches `metadata.tags`; it must preserve `base_url` and `default_model`.
- Workspace ownership is enforced by `workspace_id` filter.
- Unknown tags are not stored.

## Compatibility

- Existing providers without `metadata.tags` behave as `[]`.
- Existing API clients that do not send tags continue working.
- Router ignores tags for this slice.
- Usage analytics is unchanged.

## Testing Strategy

Final verification:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual smoke:

1. Connect provider with `primary` and `cheap` tags.
2. Confirm provider list shows both tags.
3. Save tags as `backup`.
4. Confirm list updates and no credential material appears.
5. Reconnect provider without editing tags.
6. Confirm tags are preserved.
7. Open default fallback-chain editor and confirm tags appear as hints.

## Acceptance Criteria

- Provider tags are normalized to fixed allowed tags.
- New providers can be created with tags.
- Existing providers can update tags without rotating credentials.
- Reconnect preserves existing tags when tags are omitted.
- Provider list displays tag chips.
- Fallback-chain editor displays tag hints.
- No DB migration is required.
- Router behavior is unchanged.
- Docs/backlog/API contract updated.
- Lint/build/router tests pass.
