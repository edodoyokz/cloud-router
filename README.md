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
- Dashboard displays usage summary and recent router events
- Dashboard can run provider health checks and display provider health state
- Supabase-backed provider/API key persistence
- Thin Supabase Auth login/signup with hybrid workspace auto-create
- Go router can read Supabase config when env vars are set
- Non-streaming OpenAI-compatible chat completions

## Next Build Steps
1. Add preset editor UI
2. Add production cookie/SSR auth polish and workspace switching
3. Add token/cost accounting improvements
4. Add provider reconnect flow
