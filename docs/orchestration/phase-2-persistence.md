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

## Required tables

### workflows

Stores one workflow instance.

Required columns:

- `id uuid primary key`
- `workflow_type text not null`
- `status text not null`
- `current_state text not null`
- `input_json jsonb not null default '{}'::jsonb`
- `output_json jsonb`
- `metadata_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### tasks

Stores queueable work items.

Required columns:

- `id uuid primary key`
- `workflow_id uuid references workflows(id)`
- `type text not null`
- `status text not null`
- `priority int not null default 100`
- `payload_json jsonb not null default '{}'::jsonb`
- `result_json jsonb`
- `error_json jsonb`
- `run_after timestamptz not null default now()`
- `attempts int not null default 0`
- `max_attempts int not null default 3`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### task_events

Append-only workflow/task event store.

Required columns:

- `id uuid primary key`
- `workflow_id uuid references workflows(id)`
- `task_id uuid references tasks(id)`
- `event_type text not null`
- `actor_type text`
- `actor_id text`
- `payload_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

### task_leases

Tracks agent claims and lease expiration.

Required columns:

- `id uuid primary key`
- `task_id uuid not null references tasks(id)`
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

- `id uuid primary key`
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

- `id uuid primary key`
- `original_task_id uuid`
- `workflow_id uuid`
- `type text not null`
- `payload_json jsonb not null default '{}'::jsonb`
- `error_json jsonb`
- `failed_at timestamptz not null default now()`

## Repository layer

Add DB access behind interfaces instead of calling Supabase directly from route handlers.

Suggested files:

- `src/db/supabaseClient.ts`
- `src/repositories/workflowRepository.ts`
- `src/repositories/taskRepository.ts`
- `src/repositories/taskEventRepository.ts`
- `src/repositories/taskLeaseRepository.ts`
- `src/repositories/taskLockRepository.ts`
- `src/repositories/webhookDeliveryRepository.ts`
- `src/repositories/deadLetterRepository.ts`

## Core operations

Minimum operations required before merging Phase 2:

- `createWorkflow(input)`
- `getWorkflow(id)`
- `updateWorkflowState(id, nextState, status)`
- `createTask(input)`
- `getTask(id)`
- `claimNextTask(agentId, capabilities, leaseSeconds)`
- `completeTask(taskId, leaseToken, result)`
- `failTask(taskId, leaseToken, error)`
- `appendTaskEvent(event)`
- `recordWebhookDelivery(delivery)`
- `markWebhookProcessed(provider, deliveryId)`
- `moveTaskToDeadLetter(taskId, error)`

## Claim safety

The claim operation must be atomic. Two agents must not receive the same task.

Recommended approach:

1. Select eligible task with `status = 'queued'` and `run_after <= now()`.
2. Use transaction or RPC function with `FOR UPDATE SKIP LOCKED`.
3. Update task status to `leased`.
4. Insert `task_leases` row with unique `lease_token`.
5. Emit `task_events.task_leased`.

## Migration path

1. Add migration for all Phase 2 tables.
2. Add Supabase client and repository modules.
3. Keep public REST/MCP contracts stable.
4. Replace in-memory stores behind the existing functions.
5. Add fallback error messages when Supabase is not configured.
6. Add tests or typecheck coverage for repository inputs and outputs.

## Acceptance criteria

- Server restart does not lose workflows, tasks, agent runs, webhook deliveries, upstream calls, or task history.
- Multiple agents cannot claim the same task.
- Task result submission requires a valid lease token when the task was leased.
- Every task state change emits one `task_events` row.
- Webhook delivery IDs are idempotent.
- Failed terminal tasks are recorded in `dead_letter_tasks`.
- Existing MCP and REST API behavior remains backward compatible.
- `npm run typecheck` passes.
- `npm run build` passes.

## Rollout notes

- Use service-role Supabase credentials only on the backend.
- Do not expose service-role credentials to MCP clients, browser code, logs, tool output, or PR comments.
- Keep RLS disabled only for server-owned internal orchestration tables, or enforce service-role-only access explicitly.
- Do not add destructive cleanup endpoints in Phase 2.
