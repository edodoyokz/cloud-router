# Backlog v0.1 — NusaNexus Router

## P0 — Must Have
- [ ] Landing page with simple value prop
- [x] Auth system
- [x] Workspace model
- [ ] Connect provider flow
- [ ] Secure credential storage
- [x] Preset routing creator
- [ ] OpenAI-compatible endpoint
- [ ] API key generation
- [x] Basic usage dashboard
- [x] Provider health status
- [x] Fallback chain working end-to-end

## P1 — Should Have
- [ ] Copy config snippets for Claude Code / Codex / OpenClaw / Cursor
- [ ] Better onboarding wizard
- [ ] Usage charts
- [ ] Error explanation panel
- [x] Reconnect flow
- [ ] Provider tags: primary / backup / free / cheap
- [x] Pricing/cost estimation configuration

## Notes
- Provider/API key management thin slice is now implemented in `/dashboard` (list + disconnect/revoke).
- Provider reconnect/credential rotation thin slice is implemented in `/dashboard`.
- Basic usage dashboard thin slice is now implemented in `/dashboard` (summary metrics + recent usage events).
- Provider health check thin slice is implemented in `/dashboard` (manual check + status display).
- Default fallback chain editor is implemented in `/dashboard`.
- Workspace/auth polish thin slice is implemented in `/dashboard` (current workspace card + sign out).
- Token accounting thin slice is implemented for successful non-streaming chat completions.
- Pricing/cost estimation thin slice is implemented with manual workspace pricing rules.

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
