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

## Next Build Steps
1. scaffold web app
2. scaffold Go router service
3. connect Supabase schema
4. wire API contract between web and router
