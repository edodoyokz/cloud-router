# DB Schema — NusaNexus Router MVP

Target DB: **PostgreSQL**

## Design Goals
- Multi-user / multi-workspace from day one
- Secret storage encrypted at rest
- Simple routing model for MVP
- Easy to extend ke billing / team / analytics later

---

## Core Tables

### 1. users
Menyimpan akun platform.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| email | citext unique | login identifier |
| password_hash | text nullable | kalau pakai password auth |
| auth_provider | text nullable | e.g. google, github, email |
| auth_provider_id | text nullable | id dari SSO provider |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### 2. workspaces
Satu user bisa punya satu atau lebih workspace.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| owner_user_id | uuid FK users.id | owner workspace |
| name | text | nama workspace |
| slug | text unique | URL-friendly identifier |
| metadata | jsonb | workspace metadata; `metadata.onboarding` stores Quick start checklist dismiss/completion state |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### 3. workspace_members
Kalau nanti mau team collaboration.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | workspace |
| user_id | uuid FK users.id | member |
| role | text | owner, admin, member |
| created_at | timestamptz | default now() |

### 4. provider_connections
Koneksi akun/provider milik user.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | ownership boundary |
| provider_type | text | stable provider slug, e.g. codex, kimi, minimax, zai, alibaba |
| display_name | text | nama yang ditampilkan di UI |
| auth_method | text | oauth, api_key, token, cookie |
| provider_family | text | provider family, default `openai_compatible` |
| capabilities | jsonb | capability metadata, default `{}` |
| metadata | jsonb | provider metadata seperti `base_url`, `default_model`, dan routing hint `tags` |
| credential_encrypted | text | encrypted provider API key payload (never returned in API responses) |
| status | text | active, expired, error, disconnected |
| quota_state | jsonb | cached quota / limit info |
| last_checked_at | timestamptz nullable | health check terakhir |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Provider routing hint tags are stored in `metadata.tags` as an array of fixed values: `primary`, `backup`, `free`, `cheap`. No separate tag table is required for MVP.

### 5. routing_presets
Preset routing yang dipilih user.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | owner workspace |
| name | text | Hemat / Stabil / Kualitas |
| description | text nullable | helper copy |
| is_default | boolean | preset aktif default |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### 6. routing_preset_steps
Urutan provider/model dalam satu preset.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| preset_id | uuid FK routing_presets.id | parent preset |
| order_index | integer | prioritas 1,2,3... |
| provider_connection_id | uuid FK provider_connections.id | provider target |
| model_alias | text nullable | alias model yang dipakai |
| fallback_mode | text | failover, round_robin, sticky |
| min_quota_pct | numeric nullable | optional guard |
| created_at | timestamptz | default now() |

### 7. api_keys
API key untuk dipakai tool coding.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | ownership |
| name | text | label key |
| key_hash | text unique | simpan hash, bukan raw key |
| prefix | text | potongan untuk identifikasi |
| last_used_at | timestamptz nullable | audit ringan |
| revoked_at | timestamptz nullable | null kalau aktif |
| created_at | timestamptz | default now() |

### 8. usage_events
Log usage dasar untuk dashboard.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | owner workspace |
| provider_connection_id | uuid FK provider_connections.id | provider yang dipakai |
| api_key_id | uuid FK api_keys.id nullable | key pemicu request |
| preset_id | uuid FK routing_presets.id nullable | preset yang dipakai |
| request_id | text nullable | correlation id |
| model_requested | text nullable | model dari tool |
| model_resolved | text nullable | model final |
| prompt_tokens | integer default 0 | token masuk |
| completion_tokens | integer default 0 | token keluar |
| total_tokens | integer default 0 | total |
| estimated_cost_usd | numeric nullable | optional tracking |
| status | text | success, failed, fallback |
| error_code | text nullable | kalau gagal |
| created_at | timestamptz | default now() |

> **Failure events** use the same `usage_events` table with `status = "failed"`, `error_code` set to a structured code (e.g. `preset_not_found`, `fallback_exhausted`, `provider_request_failed`), and `prompt_tokens`, `completion_tokens`, `total_tokens` set to `0`. Failure events never store prompts, completions, provider response bodies, or credential material.

### 9. model_pricing_rules
Manual workspace pricing rules used for cost estimation.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | owner workspace |
| provider_connection_id | uuid FK provider_connections.id nullable | optional provider-specific rule; null means workspace-wide |
| model_pattern | text | exact model match for MVP |
| input_usd_per_1m_tokens | numeric | prompt/input price per 1M tokens |
| output_usd_per_1m_tokens | numeric | completion/output price per 1M tokens |
| currency | text | USD for MVP |
| status | text | active, disabled |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### 10. request_logs
Log teknis untuk debugging, bisa dimatikan di production.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | boundary |
| request_id | text unique | correlation |
| direction | text | inbound, outbound |
| provider_type | text nullable | provider tujuan |
| payload_redacted | jsonb | payload yang sudah disensor |
| response_redacted | jsonb nullable | response yang disensor |
| latency_ms | integer nullable | timing |
| status_code | integer nullable | HTTP status |
| created_at | timestamptz | default now() |

### 11. audit_events
Perubahan penting untuk keamanan dan support.

| column | type | notes |
|---|---|---|
| id | uuid PK | generated server-side |
| workspace_id | uuid FK workspaces.id | boundary |
| actor_user_id | uuid FK users.id | siapa yang melakukan |
| event_type | text | provider_added, key_created, preset_updated, login_failed, dll |
| event_data | jsonb | detail ringkas |
| created_at | timestamptz | default now() |

---

## Recommended MVP Constraints

- `users.email` unique
- `workspaces.slug` unique
- `api_keys.key_hash` unique
- `provider_connections` harus selalu terkait ke `workspace_id`
- credential selalu encrypted sebelum disimpan
- request_logs hanya simpan data yang sudah di-redact

---

## Indexes

Recommended indexes:
- `workspaces(owner_user_id)`
- `provider_connections(workspace_id, provider_type)`
- `routing_presets(workspace_id, is_default)`
- `routing_preset_steps(preset_id, order_index)`
- `api_keys(workspace_id, revoked_at)`
- `usage_events(workspace_id, created_at desc)`
- `model_pricing_rules(workspace_id, status)`
- `model_pricing_rules(workspace_id, provider_connection_id, model_pattern)`
- `request_logs(workspace_id, created_at desc)`
- `audit_events(workspace_id, created_at desc)`

---

## MVP Data Flow

1. User login
2. App resolves workspace
3. User adds provider connection
4. User creates preset routing
5. App generates API key
6. Request masuk via API key
7. Router resolve preset and step
8. Router forward request
9. Usage event + audit event tersimpan

---

## Future Tables
Bisa ditambahkan nanti:
- `billing_subscriptions`
- `workspace_limits`
- `provider_health_checks`
- `model_aliases`
- `shared_presets`
- `notifications`
- `webhook_endpoints`
