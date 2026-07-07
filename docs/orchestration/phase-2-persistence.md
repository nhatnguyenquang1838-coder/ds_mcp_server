# Phase 2 - Persistence

## Objective

Replace in-memory orchestration state with Supabase/PostgreSQL so workflows, tasks, agent leases, webhook deliveries, and event history survive restart and support horizontal scaling.

## Scope

In scope:

- Durable `workflows`
- Durable `tasks`
- Append-only `task_events`
- Agent claim ownership through `task_leases`
- Concurrency and idempotency protection through `task_locks`
- Durable `webhook_deliveries`
- Terminal failed task handling through `dead_letter_tasks`
- Backward-compatible REST/MCP behavior

Out of scope for this phase:

- Configurable state-machine DSL
- Full dashboard UI
- Agent capability ranking
- Cron scheduler UI
- Human approval UI
- Memory retrieval/ranking

## Implemented files

- `supabase/migrations/0001_orchestration_core.sql`
- `src/db/supabaseClient.ts`
- `src/repositories/orchestrationRepository.ts`
- `src/asyncWorkflowStore.ts`
- `src/agentops/router.ts`
- `src/agentops/supabaseClient.ts`

## Runtime behavior

When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, async workflow routes use Supabase-backed persistence.

When Supabase is not configured, the async workflow routes fall back to the previous in-memory store. This preserves local MVP behavior and avoids breaking development environments that have not yet been migrated.

## Required tables

### workflows

Stores one workflow instance.

Required columns:

- `id text primary key`
- `workflow_type text not null`
- `name text not null`
- `source text not null`
- `status text not null`
- `current_state text not null`
- `current_task_id text`
- `context_json jsonb not null default '{}'::jsonb`
- `input_json jsonb not null default '{}'::jsonb`
- `output_json jsonb`
- `metadata_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### tasks

Stores queueable work items.

Required columns:

- `id text primary key`
- `workflow_id text references workflows(id)`
- `parent_task_id text references tasks(id)`
- `type text not null`
- `status text not null`
- `priority int not null default 100`
- `payload_json jsonb not null default '{}'::jsonb`
- `result_json jsonb`
- `error_json jsonb`
- `lease_owner text`
- `lease_token text`
- `lease_expires_at timestamptz`
- `wait_key text`
- `run_after timestamptz not null default now()`
- `retry_count int not null default 0`
- `attempts int not null default 0`
- `max_retries int not null default 3`
- `max_attempts int not null default 3`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `completed_at timestamptz`

### task_events

Append-only workflow/task event store.

Required columns:

- `id text primary key`
- `workflow_id text references workflows(id)`
- `task_id text references tasks(id)`
- `event_type text not null`
- `actor text`
- `actor_type text`
- `actor_id text`
- `data_json jsonb not null default '{}'::jsonb`
- `payload_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

### task_leases

Tracks agent claims and lease expiration.

Required columns:

- `id text primary key`
- `task_id text not null references tasks(id)`
- `agent_id text not null`
- `lease_token text not null unique`
- `status text not null`
- `leased_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- `released_at timestamptz`

### task_locks

Protects critical transitions and idempotent operations.

Required columns:

- `lock_key text primary key`
- `owner_id text`
- `expires_at timestamptz not null`
- `created_at timestamptz not null default now()`

### webhook_deliveries

Stores inbound GitHub or external webhook delivery attempts.

Required columns:

- `id text primary key`
- `provider text not null`
- `delivery_id text not null`
- `event_type text not null`
- `payload_json jsonb not null default '{}'::jsonb`
- `status text not null`
- `received_at timestamptz not null default now()`
- `processed_at timestamptz`
- `error_json jsonb`

Constraints:

- unique `(provider, delivery_id)`

### dead_letter_tasks

Stores tasks that cannot be retried safely.

Required columns:

- `id text primary key`
- `original_task_id text`
- `workflow_id text`
- `type text not null`
- `payload_json jsonb not null default '{}'::jsonb`
- `error_json jsonb`
- `failed_at timestamptz not null default now()`

## Repository layer

DB access is isolated behind repository functions instead of direct Supabase calls from route handlers.

Current implementation:

- `src/repositories/orchestrationRepository.ts`

Future split if the module grows:

- `src/repositories/workflowRepository.ts`
- `src/repositories/taskRepository.ts`
- `src/repositories/taskEventRepository.ts`
- `src/repositories/taskLeaseRepository.ts`
- `src/repositories/taskLockRepository.ts`
- `src/repositories/webhookDeliveryRepository.ts`
- `src/repositories/deadLetterRepository.ts`

## Core operations

Implemented or scaffolded by the repository/store layer:

- `createWorkflowRecord(input)`
- `getWorkflowRecord(id)`
- `updateWorkflowStatus(id, status)`
- `createTaskRecord(input)`
- `claimNextTaskRecord(agentId, capabilities, leaseSeconds)`
- `updateTaskResultRecord(taskId, result)`
- `appendTaskEvent(event)`
- `recordWebhookDelivery(delivery)`
- `markWebhookDeliveryProcessed(provider, deliveryId)`
- `dead_letter_tasks` insert on terminal failure

## Claim safety

The claim operation is persistence-backed. It selects eligible queued or expired leased tasks, attempts a guarded update, creates a `task_leases` row, and emits a `task_claimed` event.

A future hardening step should move the claim operation into a Postgres RPC function with `FOR UPDATE SKIP LOCKED` for stronger concurrency guarantees under high parallel load.

## Acceptance criteria

- Server restart does not lose workflows, tasks, task events, leases, webhook deliveries, or dead-letter records when Supabase is configured.
- Async workflow APIs remain usable without Supabase through in-memory fallback.
- Multiple agents are guarded from claiming the same task through conditional update and lease records.
- Webhook delivery IDs are idempotent through unique `(provider, delivery_id)`.
- Failed terminal tasks are recorded in `dead_letter_tasks`.
- Existing MCP and REST API behavior remains backward compatible.
- `npm run typecheck` passes.
- `npm run build` passes.

## Rollout notes

- Use service-role Supabase credentials only on the backend.
- Do not expose service-role credentials to MCP clients, browser code, logs, tool output, or PR comments.
- Keep RLS disabled only for server-owned internal orchestration tables, or enforce service-role-only access explicitly.
- Do not add destructive cleanup endpoints in Phase 2.
