# Auth Flow — NusaNexus Router

## Overview

NusaNexus Router punya dua jalur auth yang berbeda:

1. **User auth** — login ke dashboard via Supabase Auth
2. **API key auth** — tool coding hit router endpoint via API key

---

## 1. User Auth (Dashboard)

### Flow

```text
Browser → Vercel (Next.js) → Supabase Auth
```

### Steps

1. User buka `/login` atau `/signup`
2. User submit email + password (atau SSO)
3. Next.js call Supabase Auth API
4. Supabase return JWT access token + refresh token
5. Token disimpan di cookie/session browser
6. Next.js proxy protects `/dashboard` and redirects unauthenticated users to `/login?next=/dashboard`
7. Request API route can resolve auth from bearer token or Supabase cookie session
8. JWT/user identity dipakai untuk resolve workspace

MVP note: control-plane API routes accept Supabase bearer tokens from browser requests and can also resolve the authenticated user from Supabase SSR cookies when bearer is absent. Session identity is mapped into internal `users` rows (`auth_provider='supabase'`, `auth_provider_id=auth.users.id`, `email=auth.users.email`), then membership is ensured in `workspaces/workspace_members` (auto-create personal workspace when needed).

The thin slice now uses the Next.js proxy convention with Supabase cookie auth for `/dashboard` and keeps `DEV_WORKSPACE_ID` as a local-only fallback for selected API resolution paths.

### Current Resolution Order (API auth helper)

1. `Authorization: Bearer <token>`
2. Supabase cookie session
3. `DEV_WORKSPACE_ID` fallback for `resolveWorkspaceContext()` only (local/dev bridge)

`requireAuthenticatedWorkspaceContext()` does **not** use the dev fallback and still rejects unauthenticated requests.

### Auth Callback

`/auth/callback` exchanges Supabase `code` for a session and redirects to a safe local `next` path (default `/dashboard`).

Password reset uses the same callback entry point:
- User opens `/forgot-password` and submits email.
- Supabase sends email with redirect to `/auth/callback?next=/reset-password`.
- Callback exchanges code for session and redirects to `/reset-password`.
- `/reset-password` updates password and then can bootstrap workspace before opening dashboard.

Login/signup also include OAuth buttons for Google and GitHub via Supabase OAuth, both redirecting through `/auth/callback`.

### JWT Lifecycle

| Event | Action |
|-------|--------|
| Login sukses | Supabase issue access token (1 jam) + refresh token |
| Access token expire | Supabase client auto-refresh via refresh token |
| Refresh token expire | User harus login ulang |
| Logout | Invalidate session, clear cookies |

### Supabase Auth Config

- Auth provider: email/password (MVP default)
- Optional SSO: Google, GitHub (bisa ditambahkan via Supabase dashboard)
- Email confirmation: optional di MVP, bisa di-enable later
- Password policy: minimal 8 karakter (Supabase default)

---

## 2. API Key Auth (Router Data Plane)

### Flow

```text
Coding Tool → VPS Router → Supabase (validate) → Process Request
```

### Steps

1. User generate API key di dashboard (`/dashboard/endpoint`)
2. Dashboard generate random key, hash dengan SHA-256, simpan hash ke `api_keys` table
3. Raw key ditampilkan sekali ke user (format: `nnr_xxxxxxxxxxxx`)
4. User copy key ke tool coding config
5. Tool kirim request ke VPS dengan header `Authorization: Bearer nnr_xxxxxxxxxxxx`
6. Router terima request, hash incoming key dengan SHA-256
7. Router lookup hash di `api_keys` table via Supabase
8. Jika match dan `revoked_at` null → resolve `workspace_id`
9. Router proceed dengan routing logic
10. Router update `last_used_at` di `api_keys`

### API Key Format

```
Prefix: nnr_
Body: 32 karakter random (base62)
Full: nnr_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### API Key Storage

| Field | Value |
|-------|-------|
| `key_hash` | SHA-256 hash dari full key |
| `prefix` | `nnr_a1b2` (6 karakter pertama, untuk identifikasi di UI) |
| `name` | Label yang user beri (e.g. "Claude Code laptop") |
| `revoked_at` | null jika aktif, timestamp jika di-revoke |

### Validation Logic (Router)

```text
1. Extract bearer token dari Authorization header
2. Reject jika kosong atau format salah → 401
3. SHA-256 hash token
4. Query api_keys WHERE key_hash = hash AND revoked_at IS NULL
5. Jika tidak ditemukan → 401 "invalid_api_key"
6. Jika ditemukan → extract workspace_id
7. Load workspace config, preset, provider connections
8. Proceed routing
```

---

## 3. Control Plane → Data Plane Trust

Router (VPS) dan dashboard (Vercel) berkomunikasi via Supabase sebagai shared data layer. Tidak ada direct API call antara keduanya.

### Trust Model

```text
Dashboard writes config → Supabase
Router reads config ← Supabase
```

- Dashboard pakai `SUPABASE_SERVICE_ROLE_KEY` untuk write workspace/preset/provider data
- Router pakai `SUPABASE_SERVICE_ROLE_KEY` untuk read workspace config dan validate API keys
- Tidak ada JWT exchange antara dashboard dan router
- Data boundary: workspace_id (semua query di-scope per workspace)

### Why Not Direct API

- Simpler trust model — satu source of truth (Supabase)
- No need untuk service-to-service auth
- Easier to reason about data flow
- Supabase RLS bisa dipakai untuk extra safety

---

## 4. Provider Credential Flow

MVP provider support is generic OpenAI-compatible API-key configuration. Provider OAuth is not part of the current runtime path.

### Flow

```text
Browser dashboard → Next.js API route → encrypt credential → Supabase
Router → Supabase → decrypt credential → provider chat-completions endpoint
```

### Steps

1. User opens `/dashboard` and submits provider display name, base URL, default model, and API key.
2. The control-plane API validates the OpenAI-compatible provider input.
3. The API encrypts the provider API key with server-side `ENCRYPTION_KEY`.
4. The encrypted credential is stored in `provider_connections.credential_encrypted`.
5. List/detail APIs never return raw provider credentials or encrypted credential material.
6. The router loads active provider config from Supabase for the workspace/preset.
7. The router decrypts the credential server-side and forwards non-streaming chat-completion requests.
8. Reconnect/rotation updates the existing provider credential in place and requires a new API key.

---

## 5. Security Checklist

- [ ] API keys di-hash sebelum disimpan (SHA-256)
- [ ] Raw API key hanya ditampilkan sekali saat generate
- [ ] JWT access token short-lived (1 jam)
- [ ] Provider credentials always encrypted at rest
- [ ] `SUPABASE_SERVICE_ROLE_KEY` never exposed ke client
- [ ] Semua API routes validate auth sebelum proses
- [ ] Workspace isolation: query selalu filter by `workspace_id`
- [ ] Revoked keys immediately rejected
