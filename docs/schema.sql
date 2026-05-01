-- NusaNexus Router MVP - PostgreSQL schema
-- Base schema for MVP, designed for multi-workspace hosted AI routing

create extension if not exists citext;
create extension if not exists pgcrypto;

-- users
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text,
  auth_provider text,
  auth_provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- workspaces
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- workspace members
create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- provider connections
create table if not exists provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider_type text not null,
  display_name text not null,
  auth_method text not null,
  provider_family text not null default 'openai_compatible',
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  credential_encrypted text not null,
  status text not null check (status in ('active', 'expired', 'error', 'disconnected')),
  quota_state jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_provider_connections_workspace_type
  on provider_connections (workspace_id, provider_type);

-- routing presets
create table if not exists routing_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_routing_presets_workspace_default
  on routing_presets (workspace_id, is_default);

-- routing preset steps
create table if not exists routing_preset_steps (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references routing_presets(id) on delete cascade,
  order_index integer not null,
  provider_connection_id uuid not null references provider_connections(id) on delete cascade,
  model_alias text,
  fallback_mode text not null check (fallback_mode in ('failover', 'round_robin', 'sticky')),
  min_quota_pct numeric,
  created_at timestamptz not null default now(),
  unique (preset_id, order_index)
);

create index if not exists idx_routing_preset_steps_preset_order
  on routing_preset_steps (preset_id, order_index);

-- api keys
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_keys_workspace_revoked
  on api_keys (workspace_id, revoked_at);

-- usage events
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider_connection_id uuid not null references provider_connections(id) on delete cascade,
  api_key_id uuid references api_keys(id) on delete set null,
  preset_id uuid references routing_presets(id) on delete set null,
  request_id text,
  model_requested text,
  model_resolved text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric,
  status text not null check (status in ('success', 'failed', 'fallback')),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_workspace_created
  on usage_events (workspace_id, created_at desc);

-- request logs
create table if not exists request_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  request_id text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  provider_type text,
  payload_redacted jsonb not null,
  response_redacted jsonb,
  latency_ms integer,
  status_code integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_request_logs_workspace_created
  on request_logs (workspace_id, created_at desc);

-- audit events
create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_workspace_created
  on audit_events (workspace_id, created_at desc);

-- optional updated_at trigger helper
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- triggers

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
before update on users
for each row execute function set_updated_at();

drop trigger if exists trg_workspaces_updated_at on workspaces;
create trigger trg_workspaces_updated_at
before update on workspaces
for each row execute function set_updated_at();

drop trigger if exists trg_provider_connections_updated_at on provider_connections;
create trigger trg_provider_connections_updated_at
before update on provider_connections
for each row execute function set_updated_at();

drop trigger if exists trg_routing_presets_updated_at on routing_presets;
create trigger trg_routing_presets_updated_at
before update on routing_presets
for each row execute function set_updated_at();
