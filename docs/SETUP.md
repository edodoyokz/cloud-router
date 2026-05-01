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

Schema SQL ada di `docs/schema.sql`. Untuk apply:

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
