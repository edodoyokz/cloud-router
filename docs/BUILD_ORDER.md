# Build Order — NusaNexus Router MVP

## Phase 1 — Product Foundation
1. Finalize product scope
2. Finalize provider priority
3. Finalize landing copy
4. Finalize sitemap and pages

## Phase 2 — Data Layer
1. Implement Postgres schema
2. Add migrations
3. Add workspace/user/auth models
4. Add provider connection models
5. Add preset and API key models

## Phase 3 — Core Product
1. Auth pages
2. Onboarding wizard
3. Dashboard home
4. Provider connections page
5. Presets page
6. Endpoint page
7. Usage page

Note: `/dashboard` now supports provider connection, API key generation, endpoint snippets, usage analytics, provider health, fallback-chain editing, pricing rules, onboarding checklist, provider tags, tag-based chain suggestions, reconnect/rotation, and error explanations.

## Phase 4 — Router Engine
1. OpenAI-compatible endpoint
2. Provider resolution
3. Fallback engine
4. Usage logging
5. Request logs

## Phase 5 — Polish
1. Error states
2. Empty states
3. Copy snippets for tools
4. Trust/security copy
5. QA and launch readiness

## MVP Success Definition
- User can sign up
- User can connect at least one provider
- User can create a preset
- User can copy endpoint config
- User can send a request successfully
- Router can fallback once
- Dashboard shows provider and usage status

## Current Verification Commands

```bash
npm install
npm run lint:web
npm run build:web
node --test apps/web/lib/error-explanations.test.js
node --test apps/web/lib/provider-routing-suggestions.test.js
cd services/router && go test ./...
cd ../..
npm run dev:router
curl http://localhost:8080/health
```

Note: Supabase-backed router runtime is enabled when `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ENCRYPTION_KEY` are configured. Router unit tests use the in-memory repository.
