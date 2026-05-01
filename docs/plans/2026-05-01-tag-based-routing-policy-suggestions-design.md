# Tag-Based Routing Policy Suggestions Design

Date: 2026-05-01
Status: Approved

## Goal

Use existing provider routing hint tags (`primary`, `backup`, `free`, `cheap`) to suggest a sensible default fallback chain in the NusaNexus Router dashboard without changing router behavior automatically.

## Current State

- Provider tags are stored in `provider_connections.metadata.tags`.
- The dashboard can create/edit provider tags.
- The dashboard already shows tags in provider cards and fallback-chain selectors.
- The default fallback chain is edited as a local draft and persisted only when the user clicks `Save chain`.
- Router behavior is based on the saved default routing preset order.

## Recommended Approach

Add a **Tag-based suggestion** panel inside the existing **Default fallback chain** dashboard card.

The panel computes a suggested provider order from the current provider list and lets the user apply it to the local fallback-chain draft. Router behavior does not change until the user explicitly clicks the existing `Save chain` button.

This preserves user control, reuses existing server validation, avoids schema/API churn, and makes tags practically useful.

## Suggestion Rules

Create a small shared helper:

```text
apps/web/lib/provider-routing-suggestions.js
```

Export:

```js
buildTagBasedFallbackSuggestion(providers)
```

### Input

Current provider list as returned by `GET /api/providers`.

### Output

```js
{
  steps: [
    {
      provider_connection_id,
      display_name,
      status,
      health,
      model_alias: ''
    }
  ],
  reasons: [
    'Primary providers are tried first.',
    'Cheap/free providers are preferred before backup providers.',
    'Disconnected providers are excluded.'
  ],
  excluded: [
    {
      display_name,
      reason: 'Disconnected providers cannot be added to the default fallback chain.'
    }
  ]
}
```

## Provider Inclusion

Include providers whose status is:

- `active`
- `error`

Exclude providers whose status is:

- `disconnected`

This matches existing default-chain validation: providers in `error` status are allowed, but disconnected providers are rejected.

## Ordering

Suggested tag priority:

| Rank | Tag |
|---:|---|
| 1 | `primary` |
| 2 | `cheap` |
| 3 | `free` |
| 4 | `backup` |
| 5 | no recognized tag |

If a provider has multiple tags, the highest-priority tag wins. For example, `primary + cheap` ranks as `primary`.

Tie-breakers:

1. Health:
   - `ok` / `healthy` first
   - `unknown` next
   - `error` last
2. Display name alphabetically
3. ID for stable fallback ordering

## Dashboard UX

Inside the **Default fallback chain** card, above the current draft list, add:

```text
Tag-based suggestion
Primary providers first, then cheap/free, then backup.
[Apply suggestion to draft]
```

Show suggested order, for example:

```text
#1 OpenAI Production — Primary · healthy
#2 Groq Cheap — Cheap · healthy
#3 OpenRouter Backup — Backup · unknown
```

Show exclusions when relevant:

```text
Excluded:
- Old Provider — disconnected
```

When the user clicks **Apply suggestion to draft**:

- Replace `presetDraftSteps` with the suggested steps.
- Keep the draft unsaved.
- Show local status:

```text
Suggested chain applied to draft. Review it, then Save chain.
```

If no eligible providers exist, show:

```text
No eligible providers for a tag-based suggestion yet.
```

## API / Backend Scope

No new API is required for MVP.

Reasons:

- Dashboard already has provider metadata and tags.
- Existing `PUT /api/presets/default` persists ordered steps.
- Existing server validation protects against disconnected providers.

No database migration.

No router behavior change.

## Documentation

Update:

```text
README.md
docs/API_CONTRACT.md
docs/BACKLOG.md
docs/SETUP.md
```

Document that:

- Tags can generate a suggested fallback-chain draft.
- Suggestions do not affect routing until the user saves the chain.
- Disconnected providers are excluded.
- Router still follows saved preset order.

## Verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual checks:

1. Tag providers as `primary`, `cheap`, `free`, and `backup`.
2. Open Default fallback chain.
3. Confirm suggested order matches tag priority.
4. Click `Apply suggestion to draft`.
5. Confirm chain draft changes but is not persisted until `Save chain`.
6. Save chain and reload.
7. Confirm saved order remains.
