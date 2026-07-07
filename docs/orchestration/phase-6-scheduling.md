# Phase 6 - Scheduling

## Objective

Add first-class scheduling for delayed work, recurring work, retries, exponential backoff, timeout detection, and lease expiration.

This removes reliance on ad hoc polling logic scattered across route handlers.

## Capabilities

- Delayed tasks using `tasks.run_after`
- Cron tasks for recurring workflows
- Retry policy per task type
- Exponential backoff after failure
- Timeout detection for long-running tasks
- Lease expiration and requeue
- Scheduler event emission

## Recommended tables

Future tables after Phase 2:

- `cron_schedules`
- `retry_policies`
- `scheduler_runs`

### cron_schedules

- `id uuid primary key`
- `workflow_type text not null`
- `cron_expression text not null`
- `timezone text not null default 'UTC'`
- `payload_json jsonb not null default '{}'::jsonb`
- `enabled boolean not null default true`
- `last_run_at timestamptz`
- `next_run_at timestamptz`
- `created_at timestamptz not null default now()`

### retry_policies

- `id uuid primary key`
- `task_type text not null unique`
- `max_attempts int not null default 3`
- `base_delay_seconds int not null default 30`
- `max_delay_seconds int not null default 3600`
- `backoff_multiplier numeric not null default 2`

### scheduler_runs

- `id uuid primary key`
- `scheduler_id text not null`
- `started_at timestamptz not null default now()`
- `completed_at timestamptz`
- `status text not null`
- `summary_json jsonb not null default '{}'::jsonb`

## Scheduler loop

Each scheduler tick should:

1. Acquire scheduler lock.
2. Detect expired leases.
3. Requeue eligible tasks or move terminal failures to dead letter.
4. Create due cron tasks.
5. Emit events for every action.
6. Release scheduler lock.

## Retry behavior

On task failure:

- Increment `attempts`.
- If attempts remain, set status to `queued` and compute next `run_after`.
- If attempts are exhausted, move task to `dead_letter_tasks`.
- Emit retry or dead-letter event.

## Acceptance criteria

- Delayed tasks are not claimable before `run_after`.
- Expired leases are detected and handled safely.
- Retry timing follows configured policy.
- Exhausted retries are moved to dead letter.
- Cron schedules do not create duplicate tasks for the same run window.
- Scheduler actions are auditable through events.
