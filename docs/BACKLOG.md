# Backlog v0.1 — NusaNexus Router

## P0 — Must Have
- [ ] Landing page with simple value prop
- [x] Auth system
- [x] Workspace model
- [x] Connect provider flow
- [x] Secure credential storage
- [x] Preset routing creator
- [x] OpenAI-compatible endpoint
- [x] API key generation
- [x] Basic usage dashboard
- [x] Provider health status
- [x] Fallback chain working end-to-end

## P1 — Should Have
- [x] Production SSR/cookie auth hardening
- [x] Copy config snippets for Claude Code / Codex / OpenClaw / Cursor
- [x] Better onboarding wizard
- [x] Usage charts and provider breakdowns
- [x] Error explanation panel
- [x] Password reset and OAuth login polish
- [x] Reconnect flow
- [x] Provider tags: primary / backup / free / cheap
- [x] Pricing/cost estimation configuration
- [x] Tag-based routing policy suggestions

## Notes
- Provider connection flow, encrypted provider credential storage, router API key generation, and non-streaming OpenAI-compatible endpoint are implemented for the MVP.
- Provider/API key management thin slice is now implemented in `/dashboard` (list + disconnect/revoke).
- Provider reconnect/credential rotation thin slice is implemented in `/dashboard`.
- Basic usage dashboard thin slice is now implemented in `/dashboard` (summary metrics + recent usage events).
- Provider health check thin slice is implemented in `/dashboard` (manual check + status display).
- Default fallback chain editor is implemented in `/dashboard`.
- Workspace/auth polish thin slice is implemented in `/dashboard` (current workspace card + sign out).
- Token accounting thin slice is implemented for successful non-streaming chat completions.
- Pricing/cost estimation thin slice is implemented with manual workspace pricing rules.
- Onboarding snippets thin slice is implemented in `/dashboard` Endpoint config.
- SSR/cookie auth hardening thin slice is implemented with `/dashboard` protected by a Next.js proxy and bearer-or-cookie API auth resolution.
- Provider tag routing hints are implemented in `/dashboard` and stored in provider metadata; router policy remains manual for MVP.
- Tag-based fallback-chain suggestions are implemented in `/dashboard` as local draft suggestions; persistence still requires saving `/api/presets/default`.
- Persisted Quick start onboarding checklist is implemented in `/dashboard` with workspace metadata state.
- Dashboard route protection now uses the Next.js proxy convention with Supabase cookie auth.
- Password reset flow (`/forgot-password` → `/auth/callback?next=/reset-password` → `/reset-password`) and Google/GitHub OAuth entry points are implemented.
- Error explanation panels are implemented in `/dashboard` for usage-event failures/fallbacks and provider health warnings/errors using sanitized metadata only.
- Router failure usage recording thin slice is implemented: authenticated router failures (preset-not-found, provider-not-found, unsupported provider type, invalid metadata, credential errors, invalid payload, fallback-exhausted, and non-retryable provider HTTP errors) are recorded as zero-token `failed` usage events with structured `error_code` for dashboard explanations.

## P2 — Nice to Have
- [ ] Team workspace
- [ ] Shared presets
- [ ] Model alias marketplace
- [ ] More detailed analytics
- [ ] Scheduled usage reports
- [ ] Multi-region routing

## Build Order

> See [`BUILD_ORDER.md`](./BUILD_ORDER.md) for detailed phased build plan.

## Done Criteria for v0.1
- User can sign up
- User can connect at least one provider
- User can create one preset
- User can copy endpoint config
- User can send a request successfully
- Router can fallback once
- Dashboard shows active state
