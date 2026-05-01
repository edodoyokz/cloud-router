# Developer Setup — NusaNexus Router

## Prerequisites

- **Node.js** >= 18
- **Go** >= 1.21
- **npm** >= 9 (workspace support)
- **Supabase CLI** (optional, untuk local dev)
- **Git**

---

## 1. Clone & Install

```bash
git clone <repo-url> 9router-cloud-impl
cd 9router-cloud-impl

# install Node.js dependencies (root + workspaces)
npm install
```

---

## 2. Environment Variables

Copy contoh env file dan isi sesuai kebutuhan:

```bash
cp .env.example .env
```

Lihat `docs/ENV_CONFIG.md` untuk daftar lengkap variabel.

---

## 3. Run Web App (Next.js)

```bash
npm run dev:web
```

Buka `http://localhost:3000`.

Open `/signup` to create an account, then `/login` and `/dashboard`.
For local development without auth, `DEV_WORKSPACE_ID` can still be used as a fallback.

Supabase Auth redirect URL should include:
- `http://localhost:3000/auth/callback`
- your production `/auth/callback` URL equivalent

---

## 4. Run Router Service (Go)

```bash
npm run dev:router
```

Atau langsung:

```bash
cd services/router
go run .
```

Router listen di `http://localhost:8080`.

### Verify router

```bash
curl http://localhost:8080/health
# expected: {"ok":true}
```

---

## 5. Supabase Setup

### Option A: Supabase Cloud (recommended untuk MVP)

1. Buat project di [supabase.com](https://supabase.com)
2. Copy project URL dan anon key ke `.env`
3. Jalankan migration:

```bash
# via Supabase dashboard SQL editor
# paste isi docs/schema.sql
```

### Option B: Supabase Local (via CLI)

```bash
supabase init
supabase start
supabase db reset  # apply migrations
```

---

## 6. Database Migration

Schema SQL ada di `docs/schema.sql`. Apply the latest `docs/schema.sql` so `model_pricing_rules` exists. Untuk apply:

```bash
# via psql
psql $DATABASE_URL -f docs/schema.sql

# atau via Supabase dashboard → SQL Editor → paste schema.sql
```

---

## 7. Verify Full Stack

1. Web app running di `:3000`
2. Router running di `:8080`
3. Supabase project active
4. `curl localhost:8080/health` → `{"ok":true}`
5. Web app bisa login (setelah auth wired)

## 8. Current Quick Verification Commands

```bash
npm install
npm run build:web
cd services/router && go test ./...
cd ../..
npm run dev:router
curl http://localhost:8080/health
```

Notes:
- Full DB-backed runtime still needs Supabase repository integration in router.
- Current router unit tests are designed to pass with in-memory repository.

## Thin Slice Supabase Persistence

1. Apply `docs/schema.sql` to Supabase.
2. Create or identify a workspace row.
3. Set `DEV_WORKSPACE_ID=<workspace uuid>` in local env for web API routes.
4. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ENCRYPTION_KEY` for both web API routes and router service.
5. Create provider via `POST /api/providers`.
6. Create API key via `POST /api/endpoint/keys`.
7. Use returned raw key against router `/v1/chat/completions`.
8. After logging in and opening `/dashboard`, create a provider/key, confirm they appear in the lists, then test disconnect/revoke.
9. After sending a router request, open `/dashboard` and check the Usage section. Change period filters (Today, 7 days, 30 days) to confirm reload behavior.
10. Use the provider card's `Check health` button to run a tiny chat-completion probe. Valid providers should become `active/healthy`; invalid credentials or base URLs become `error` with a sanitized message.
11. Open `/dashboard`, use Default fallback chain to reorder providers, save, refresh, and confirm the order persists. The router uses this default chain for `model: "auto"` requests.
12. Open `/dashboard` and confirm the Workspace card shows authenticated user/workspace after login, or explicit dev fallback mode when using `DEV_WORKSPACE_ID`.
13. Send a router request to a provider that returns OpenAI-compatible `usage`; confirm `/dashboard` Usage shows prompt/completion/total token counts.
14. Use a provider card's `Reconnect / rotate key` form to submit a new provider API key/base URL/default model, then run `Check health` manually to verify the provider.
15. Create a Pricing rules entry for the model shown in recent usage, then refresh Usage and confirm estimated cost is no longer `not configured`.
16. Use `/dashboard` Endpoint config snippets for Generic env, cURL, Claude Code, Codex, OpenClaw, or Cursor. Snippets include the raw key only immediately after key generation; otherwise they show `<generate-an-api-key-first>`.
17. Open `/dashboard` without a session and confirm redirect to `/login?next=/dashboard`.
18. Log in, confirm redirect/link can open `/dashboard`, and confirm Workspace card shows `authenticated` mode.
19. Call same-origin APIs from the authenticated browser session without manually adding a bearer header to confirm cookie auth works.
20. After generating traffic, open `/dashboard`, switch usage period, and confirm Usage analytics shows trend bars plus provider/model/status breakdowns.
21. Tag a provider as `primary` or `backup` in `/dashboard`, save tags, and confirm the fallback-chain editor shows those tag hints.
22. Use the `/dashboard` Quick start card to confirm progress changes as provider, health, key, snippet copy, and first request milestones are completed. Dismiss and show the card again to verify workspace-persisted visibility.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` gagal | Pastikan Node >= 18, hapus `node_modules` dan retry |
| Go build error | Pastikan Go >= 1.21, run `go mod tidy` di `services/router` |
| Supabase connection refused | Cek `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di `.env` |
| Port 3000 sudah dipakai | Kill process atau ubah port di `next.config.mjs` |
| Port 8080 sudah dipakai | Set `ROUTER_PORT` env var |

---

## Project Structure

```
9router-cloud-impl/
├── apps/web/              # Next.js UI (Vercel)
├── services/router/       # Go router (VPS)
│   ├── internal/
│   │   ├── contracts/     # OpenAI-compatible types
│   │   ├── engine/        # routing engine, registry, resolver, fallback
│   │   └── httpserver/    # HTTP handlers
│   └── main.go
├── packages/shared/       # shared constants, provider registry
├── docs/                  # product + engineering docs
└── package.json           # monorepo root
```
