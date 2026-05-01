# Environment Variables — NusaNexus Router

## Overview

Semua environment variables dikelompokkan per service. Buat file `.env` di root project atau set di masing-masing deployment environment.

---

## Web App (`apps/web`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | — | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | Supabase service role key (server-side only, NEVER expose ke client) |
| `ENCRYPTION_KEY` | yes | — | 32-byte hex key used by web API routes to encrypt provider API keys before persistence. |
| `DEV_WORKSPACE_ID` | optional local fallback | — | Workspace UUID fallback when no bearer auth session is provided. Do not rely on this in production. |
| `NEXT_PUBLIC_ROUTER_BASE_URL` | yes | `http://localhost:8080` | Base URL router data plane |
| `NEXT_PUBLIC_APP_URL` | no | `http://localhost:3000` | Public URL web app |
| `NEXTAUTH_SECRET` | yes | — | Secret untuk session encryption (jika pakai NextAuth) |

---

## Router Service (`services/router`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ROUTER_PORT` | no | `8080` | Port HTTP server |
| `SUPABASE_URL` | yes | — | Supabase project URL (untuk fetch workspace/preset data) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | Supabase service role key (untuk validasi API key dan read data) |
| `ENCRYPTION_KEY` | yes | — | 32-byte hex key untuk decrypt provider credentials |
| `LOG_LEVEL` | no | `info` | Log level: debug, info, warn, error |
| `REQUEST_TIMEOUT_MS` | no | `30000` | Timeout per provider request (ms) |
| `MAX_FALLBACK_HOPS` | no | `3` | Maksimum fallback attempts |

---

## Supabase

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | yes (migration) | — | PostgreSQL connection string (untuk psql / migration tools) |

---

## Provider-Specific (di router runtime)

Generic OpenAI-compatible provider API keys disimpan encrypted di database, bukan sebagai env vars. Namun beberapa provider mungkin butuh config tambahan:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CODEX_OAUTH_CLIENT_ID` | for Codex | — | OAuth client ID untuk Codex |
| `CODEX_OAUTH_CLIENT_SECRET` | for Codex | — | OAuth client secret |
| `CODEX_OAUTH_REDIRECT_URI` | for Codex | — | OAuth redirect URI |

---

## Contoh `.env`

```env
# === Web App ===
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
DEV_WORKSPACE_ID=
NEXT_PUBLIC_ROUTER_BASE_URL=https://router.yourdomain.com
NEXT_PUBLIC_APP_URL=https://router.nusanexus.cloud
NEXTAUTH_SECRET=your-random-secret-here

# === Router ===
ROUTER_PORT=8080
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
LOG_LEVEL=info
REQUEST_TIMEOUT_MS=30000
MAX_FALLBACK_HOPS=3

# === Supabase Migration ===
DATABASE_URL=postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres

# === Provider OAuth (if applicable) ===
CODEX_OAUTH_CLIENT_ID=your-client-id
CODEX_OAUTH_CLIENT_SECRET=your-client-secret
CODEX_OAUTH_REDIRECT_URI=https://router.nusanexus.cloud/api/auth/callback/codex
```

---

## Security Rules

- **NEVER** commit `.env` ke git — pastikan ada di `.gitignore`
- `SUPABASE_SERVICE_ROLE_KEY` hanya boleh ada di server-side (web API routes dan router service)
- `ENCRYPTION_KEY` hanya boleh ada di router service
- `NEXT_PUBLIC_*` prefix berarti value akan terexpose ke browser — hanya untuk non-secret values
- Rotate `ENCRYPTION_KEY` memerlukan re-encrypt semua credentials di database
