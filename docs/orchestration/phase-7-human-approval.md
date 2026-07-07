# Phase 7 - Human Approval

## Objective

Add explicit approval gates before sensitive workflow transitions, especially before code modification or PR creation.

Example flow:

```text
plan_changes
  -> waiting_approval
  -> modify_code
```

## Scope

In scope:

- Approval states in workflows
- Approve/reject API
- Approval events
- Human-readable approval payloads
- ChatGPT/Web UI approval surface

Out of scope:

- Fine-grained enterprise approval policy engine
- Multi-party quorum approval
- Legal/compliance workflow

## Recommended tables

Future table:

### approvals

- `id uuid primary key`
- `workflow_id uuid references workflows(id)`
- `task_id uuid references tasks(id)`
- `approval_type text not null`
- `status text not null`
- `requested_by text`
- `decided_by text`
- `request_json jsonb not null default '{}'::jsonb`
- `decision_json jsonb`
- `requested_at timestamptz not null default now()`
- `decided_at timestamptz`

## Approval types

Initial approval types:

- `plan_changes`
- `modify_code`
- `create_branch`
- `create_pr`
- `rerun_failed_workflow`
- `replay_dead_letter_task`

## State Engine behavior

When a transition requires approval:

1. State Engine creates an approval record.
2. Workflow state becomes `waiting_approval`.
3. No sensitive next task is created yet.
4. Approval event is emitted.
5. Approve/reject API resumes the State Engine.

## API endpoints

Suggested endpoints:

- `GET /api/approvals`
- `GET /api/approvals/{approval_id}`
- `POST /api/approvals/{approval_id}/approve`
- `POST /api/approvals/{approval_id}/reject`

## Acceptance criteria

- Sensitive transitions can pause at `waiting_approval`.
- Approval/rejection is durable.
- State Engine resumes safely after approval.
- Rejection stops or redirects the workflow without creating unauthorized tasks.
- Approval decisions are visible in the event timeline.
- Approval payload is readable enough for a human to make a decision.
