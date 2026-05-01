# NusaNexus Router Cloud Impl

Scaffold repo untuk MVP NusaNexus Router.

## Stack
- `apps/web` → Next.js UI di Vercel
- `services/router` → Go router/data plane di VPS
- `packages/shared` → shared contracts / config
- Supabase → auth + Postgres + data layer

## Structure
- `apps/web/` : landing, auth, dashboard, onboarding
- `services/router/` : OpenAI-compatible endpoint, routing, fallback, usage logging
- `packages/shared/` : shared types, config, constants
- `docs/` : product/engineering notes

## Quickstart

```bash
npm install
npm run build:web
cd services/router && go test ./...
cd ../..
npm run dev:router
curl http://localhost:8080/health
```

Notes:
- Supabase-backed mode is enabled when Supabase env vars are set; otherwise router tests use the in-memory repository.
- Full DB-backed operation still requires Supabase repository wiring.
- Router unit tests currently run with the in-memory repository.

## Current Thin Slice
- Minimal `/dashboard` page for provider connection and API key generation
- Dashboard lists providers/API keys and supports disconnect/revoke actions
- Dashboard displays usage summary, token breakdown, and recent router events
- Dashboard shows usage charts and provider/model/status breakdowns
- Dashboard can run provider health checks and display provider health state
- Dashboard can edit the default fallback chain used by the router
- Dashboard can reconnect providers and rotate provider API keys
- Dashboard can configure manual pricing rules and estimate usage cost
- Dashboard shows onboarding snippets for Claude Code, Codex, OpenClaw, Cursor, env, and cURL
- Supabase-backed provider/API key persistence
- Thin Supabase Auth login/signup with hybrid workspace auto-create
- Dashboard is protected by Supabase cookie middleware while API routes still support bearer tokens and dev fallback
- Dashboard shows current workspace/auth mode and supports sign out
- Go router can read Supabase config when env vars are set
- Non-streaming OpenAI-compatible chat completions

## Next Build Steps
1. Add provider tags for primary/backup/free/cheap routing hints
2. Add better onboarding wizard with persisted checklist
3. Add password reset and OAuth provider login polish
4. Migrate Next.js middleware file convention to proxy
