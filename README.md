# 9router Cloud Impl

Scaffold repo untuk MVP 9router Cloud.

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

## Next Build Steps
1. scaffold web app
2. scaffold Go router service
3. connect Supabase schema
4. wire API contract between web and router
