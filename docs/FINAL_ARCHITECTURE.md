# Architecture — NusaNexus Router MVP

> This is the consolidated architecture doc. Supersedes the earlier draft.

---

## System Components

### 1. Web App / Dashboard (Control Plane)
- auth (signup/login)
- onboarding wizard
- provider connect page
- preset routing page
- usage page
- endpoint page
- settings page

### 2. Router API (Data Plane)
- OpenAI-compatible endpoint
- request translation
- provider selection
- fallback chain
- usage logging

### 3. Provider Connector
- OAuth / API key / account token handling
- reconnect flow
- token refresh if needed
- health check provider

### 4. Persistence Layer
- users, workspaces
- provider connections
- presets, preset steps
- API keys
- usage events, request logs, audit trail

### 5. Worker / Queue (post-MVP)
- async sync jobs
- token refresh jobs
- health checks
- cleanup jobs
- cache/queue: Redis (when needed)

---

## Stack Decision

### Control Plane
- **Vercel free tier**
- frontend / landing page / dashboard / onboarding
- Next.js app UI

### Data Plane
- **VPS kamu**
- router engine
- provider resolution
- fallback chain
- request forwarding
- usage logging

### Data Layer
- **Supabase free tier**
- auth
- Postgres
- workspace data
- provider metadata
- presets
- API keys
- usage events

### Cost Anchor
- VPS subscription already exists
- Alibaba subscription on the VPS is the main engine-cost anchor until next year

---

## High-Level Diagram

```text
┌──────────────────────────────────────────────┐
│               VERCEL (FREE)                  │
│  Landing Page / Dashboard / Onboarding / UI  │
└───────────────┬──────────────────────────────┘
                │
                │ auth + data requests
                v
┌──────────────────────────────────────────────┐
│               SUPABASE (FREE)                │
│  Auth + Postgres + Workspaces + Presets      │
│  Provider metadata + API keys + usage events  │
└───────────────┬──────────────────────────────┘
                │
                │ signed API key / workspace config
                v
┌──────────────────────────────────────────────┐
│                    VPS                       │
│      Go Router API / Data Plane Engine       │
│  - OpenAI-compatible endpoint                │
│  - Provider routing                           │
│  - Fallback chain                             │
│  - Usage logging                              │
│  - Request forwarding                         │
└───────────────┬──────────────────────────────┘
                │
                │ provider calls
                v
┌──────────────────────────────────────────────┐
│         PROVIDERS / ACCOUNTS USER PUNYA      │
│  Codex OAuth / Kimi / MiniMax / ZAI / Alibaba │
└──────────────────────────────────────────────┘
```

---

## Provider Extensibility Principle

From day one, the system should treat every provider as a pluggable integration.

### Provider categories
- OAuth providers
- API key providers
- token/cookie providers if needed later

### Design rules
- no provider-specific logic in the UI when a generic flow works
- use a provider registry and capability metadata
- keep connection auth method abstracted
- treat primary/secondary/fallback as workspace configuration, not hardcoded app behavior
- make adding a new provider mostly a data/config change plus one adapter

---

## Why This Split Works

### Vercel
- cepat build UI
- free untuk MVP
- tidak membebani VPS kecil

### Supabase
- auth + DB managed
- multi-tenant data model lebih mudah
- cocok untuk workspace, preset, usage

### VPS
- paling fleksibel untuk proxy/router
- cocok untuk streaming request
- lebih aman untuk engine yang sensitif
- bisa pakai resource yang sudah kamu bayar

---

## Runtime Responsibilities

### Vercel handles
- signup/login UI
- onboarding wizard
- dashboard pages
- provider setup pages
- preset editor pages
- usage pages
- settings pages

### Supabase handles
- user identity
- workspace records
- provider connection metadata
- preset definitions
- API key records
- usage event storage
- audit trail

### VPS handles
- request auth check
- workspace/preset resolution
- provider selection
- fallback routing
- provider response translation
- usage updates
- request logs

---

## Core Data Model (Summary)

| Entity | Key Fields |
|--------|-----------|
| User | id, email, auth provider |
| Workspace | id, owner, name, slug |
| ProviderConnection | id, workspace, type, encrypted credential, status, quota |
| RoutingPreset | id, workspace, name, ordered steps, fallback rules |
| ApiKey | id, workspace, hashed key, prefix, revoked_at |
| UsageEvent | id, workspace, provider, tokens, cost, status |

> Full schema: see `DB_SCHEMA.md` and `schema.sql`

---

## Security Boundary

- raw provider credentials should not be exposed in UI
- API keys are stored hashed
- provider secrets are encrypted before persistence (see `ENCRYPTION.md`)
- dashboard only sees status + metadata
- router engine gets only what it needs for execution
- encrypt all provider credentials (AES-256-GCM)
- never expose raw tokens in UI
- separate data by workspace
- log minimal necessary metadata
- observability: logs + metrics + request traces

---

## MVP Data Flow

1. User login via Vercel UI
2. UI reads user/workspace data from Supabase
3. User adds provider connections
4. User creates preset routing
5. Vercel generates API key display page
6. User copies endpoint config
7. Tool sends request to VPS endpoint
8. VPS resolves workspace + preset
9. VPS picks provider and forwards request
10. VPS logs usage back to Supabase

---

## MVP Rule

If a component can be free tier, let it be free tier.
If a component needs stability and control, keep it on the VPS.
Provider primary choice is user-owned at the workspace level, not globally forced.
