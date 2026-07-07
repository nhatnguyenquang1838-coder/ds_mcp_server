# Phase 8 - Memory

## Objective

Connect the orchestration engine to a durable memory layer so the platform can learn from previous workflow decisions, fixes, failures, and architecture trade-offs.

This turns the system from a task runner into a learning orchestration platform.

## Scope

In scope:

- Save workflow decisions
- Reuse previous fixes
- Persist CI failure patterns
- Store architecture decisions
- Retrieve similar historical tasks before execution
- Emit memory write/read events

Out of scope:

- Fully autonomous production code changes without approval
- Unbounded context injection into agents
- Secret or credential storage in memory

## Recommended future tables

### memory_entries

- `id uuid primary key`
- `memory_type text not null`
- `source_type text not null`
- `source_id text`
- `title text not null`
- `content text not null`
- `metadata_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### memory_links

- `id uuid primary key`
- `memory_id uuid references memory_entries(id)`
- `workflow_id uuid references workflows(id)`
- `task_id uuid references tasks(id)`
- `relation_type text not null`
- `created_at timestamptz not null default now()`

### memory_retrievals

- `id uuid primary key`
- `workflow_id uuid references workflows(id)`
- `task_id uuid references tasks(id)`
- `query_text text not null`
- `result_json jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null default now()`

## Memory types

Initial memory types:

- `workflow_decision`
- `ci_failure_pattern`
- `fix_summary`
- `architecture_decision`
- `review_feedback`
- `risk_note`
- `operational_runbook`

## Runtime behavior

Before task execution:

1. State Engine prepares the task context.
2. Memory retrieval searches similar workflows, failures, fixes, and decisions.
3. Retrieved memory is attached to the agent task payload with strict size limits.
4. Retrieval event is emitted.

After task completion:

1. Result is evaluated for reusable knowledge.
2. Important decisions or fixes are saved as memory entries.
3. Memory links connect the entry back to workflow/task history.
4. Write event is emitted.

## Safety rules

- Do not store secrets, tokens, private keys, or raw credentials.
- Do not blindly trust retrieved memory; agents must treat it as context, not source of truth.
- Keep retrieval payload small and explain why each memory was included.
- Sensitive actions still require Phase 7 approval.

## Acceptance criteria

- Workflow decisions can be saved and later retrieved.
- CI failure patterns can be persisted and reused for future fixes.
- Architecture decisions are linked to the workflow/task that created them.
- Memory retrieval is auditable through task events.
- Agents receive relevant memory context without oversized prompts.
- No secret is written to memory output or logs.
