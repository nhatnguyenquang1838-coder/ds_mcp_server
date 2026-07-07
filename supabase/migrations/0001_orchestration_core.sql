create extension if not exists pgcrypto;

create table if not exists workflows (
  id text primary key,
  workflow_type text not null default 'async_agent_workflow',
  name text not null,
  source text not null check (source in ('web', 'chatgpt', 'system')),
  status text not null check (status in ('running', 'waiting', 'succeeded', 'failed', 'cancelled')),
  current_state text not null default 'created',
  current_task_id text,
  context_json jsonb not null default '{}'::jsonb,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  workflow_id text not null references workflows(id) on delete cascade,
  parent_task_id text references tasks(id) on delete set null,
  type text not null,
  status text not null check (status in ('queued', 'leased', 'running', 'waiting_external', 'succeeded', 'failed', 'cancelled', 'dead_letter')),
  priority int not null default 100,
  payload_json jsonb not null default '{}'::jsonb,
  result_json jsonb,
  error_json jsonb,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  wait_key text,
  run_after timestamptz not null default now(),
  retry_count int not null default 0,
  attempts int not null default 0,
  max_retries int not null default 3,
  max_attempts int not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists task_events (
  id text primary key,
  workflow_id text references workflows(id) on delete cascade,
  task_id text references tasks(id) on delete cascade,
  event_type text not null,
  actor text,
  actor_type text,
  actor_id text,
  data_json jsonb not null default '{}'::jsonb,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists task_leases (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  agent_id text not null,
  lease_token text not null unique,
  status text not null check (status in ('active', 'released', 'expired')),
  leased_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz
);

create table if not exists task_locks (
  lock_key text primary key,
  owner_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id text primary key,
  provider text not null,
  delivery_id text not null,
  event_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('received', 'processed', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_json jsonb,
  unique (provider, delivery_id)
);

create table if not exists dead_letter_tasks (
  id text primary key,
  original_task_id text,
  workflow_id text,
  type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  error_json jsonb,
  failed_at timestamptz not null default now()
);

create index if not exists idx_workflows_status_updated_at on workflows(status, updated_at desc);
create index if not exists idx_tasks_claimable on tasks(status, run_after, priority, created_at);
create index if not exists idx_tasks_workflow_id on tasks(workflow_id);
create index if not exists idx_task_events_workflow_created_at on task_events(workflow_id, created_at);
create index if not exists idx_task_events_task_created_at on task_events(task_id, created_at);
create index if not exists idx_task_leases_task_id_status on task_leases(task_id, status);
create index if not exists idx_task_leases_expires_at on task_leases(expires_at);
create index if not exists idx_webhook_deliveries_provider_delivery on webhook_deliveries(provider, delivery_id);
