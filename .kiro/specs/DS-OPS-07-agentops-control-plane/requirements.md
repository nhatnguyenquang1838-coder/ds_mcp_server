# Requirements Document

## Introduction

DS AgentOps Phase 7 upgrades the current MVP task orchestration flow into a stable control plane for asynchronous coding agents. The current flow already supports workflow creation, first-task creation, agent claim/execute/submit, state-engine next task creation, GitHub CI webhook handling, and dashboard reads. Phase 7 hardens this flow for safe client polling, durable task ownership, accurate CI mapping, lease recovery, operator intervention, and auditable state transitions.

Non-goals:

- Do not implement a full dashboard redesign in this spec.
- Do not replace the existing state engine with a different workflow engine.
- Do not expose destructive GitHub operations such as merge, delete branch, force-push, or secret management.
- Do not store unbounded CI logs or secrets in task results/events.

## Glossary

| Term | Definition |
|---|---|
| AgentOps | DS orchestration layer for async agent workflows, tasks, leases, scheduler, webhooks, and dashboard state. |
| Workflow | Durable parent object that groups async tasks and tracks overall status. |
| Async task | Unit of work claimed and completed by an agent or system component. |
| State engine | Server-side component that creates the next task after a task result is submitted. |
| Wait task | A `wait_github_ci` task that waits for external GitHub CI completion. |
| CI identity | Structured GitHub identity fields used to map webhook/check/run events to the correct wait task. |
| Lease | Time-bounded ownership of an async task by an agent. |
| Operator action | Manual dashboard/API action to recover or control a stuck workflow or task. |
| Agent worker | Agent role that may claim and complete tasks but must not create workflows. |
| Agent producer | Agent role that may create workflows when explicitly authorized. |
| Callback | Optional client-provided webhook target for workflow terminal or attention events. |
| Needs attention | Workflow/task state that requires operator or agent intervention. |

## Requirements

### Requirement 1: Workflow Status API

**User Story:** As a client or dashboard user, I want a compact workflow status endpoint, so that I can poll workflow progress without loading all tasks and events.

#### Acceptance Criteria

1. WHEN a client calls `GET /api/workflows/{workflow_id}/status` for an existing workflow THEN the system SHALL return a compact status payload with `workflow_id`, `status`, `current_task`, `progress`, and `needs_attention`.
2. WHEN the compact status response is generated THEN the system SHALL NOT include full task arrays, full event arrays, or large task payloads.
3. WHEN a workflow has a current task THEN the system SHALL include the current task `id`, `type`, `status`, and minimal attention metadata.
4. WHEN progress is calculated THEN the system SHALL return `done` as count of terminal successful tasks and `total` as count of known workflow tasks.
5. IF a workflow has failed tasks, dead-letter tasks, expired leases, ambiguous CI matches, or unresolved external waits THEN the system SHALL set `needs_attention` to `true`.
6. IF the workflow does not exist THEN the system SHALL return `404` with a clear error body.

### Requirement 2: Strong CI-to-Task Mapping

**User Story:** As the state engine, I want GitHub CI events mapped by structured identity, so that the correct `wait_github_ci` task is resumed and unrelated PRs/runs are not confused.

#### Acceptance Criteria

1. WHEN a `wait_github_ci` task is created THEN the system SHALL store a structured CI identity containing available fields: `repo`, `pr_number`, `head_sha`, `workflow_run_id`, `check_suite_id`, and `check_run_id`.
2. WHEN GitHub webhook input is received THEN the system SHALL parse and validate the same structured CI identity fields when present.
3. WHEN matching a CI event to a waiting task THEN the system SHALL use this precedence: `repo + workflow_run_id`, `repo + check_suite_id`, `repo + head_sha`, `repo + pr_number + head_sha`, then `repo + pr_number` fallback.
4. IF multiple waiting tasks match at the same strongest precedence THEN the system SHALL NOT complete any ambiguous task and SHALL record a needs-attention audit event.
5. IF no waiting task matches THEN the system SHALL record the webhook delivery as processed without changing task state.
6. WHEN a duplicate GitHub delivery is received THEN the system SHALL be idempotent and SHALL NOT transition a task twice.

### Requirement 3: Agent Lease Lifecycle

**User Story:** As an agent worker, I want to renew or release my lease, so that long-running tasks continue safely and abandoned tasks recover automatically.

#### Acceptance Criteria

1. WHEN an agent calls `POST /api/async-tasks/{task_id}/lease/renew` with valid ownership THEN the system SHALL extend `lease_expires_at` within the configured maximum lease duration.
2. IF a lease renew request is made by a non-owner agent THEN the system SHALL reject it with `409` or `403` and SHALL NOT change the lease.
3. WHEN an agent calls `POST /api/async-tasks/{task_id}/lease/release` with valid ownership THEN the system SHALL release ownership and return the task to a recoverable state.
4. WHEN `POST /api/scheduler/recover-expired-leases` runs THEN the system SHALL find expired leased/running tasks and requeue, retry, or dead-letter them according to retry policy.
5. IF a task exceeds `max_retries` during lease recovery THEN the system SHALL move it to `dead_letter` and mark the workflow as needing attention.
6. WHEN lease lifecycle changes occur THEN the system SHALL write task/workflow events for auditability.

### Requirement 4: Dashboard Control Actions

**User Story:** As an operator, I want dashboard/API control actions, so that I can recover stuck or failed workflows without direct database edits.

#### Acceptance Criteria

1. WHEN an operator calls `POST /api/workflows/{workflow_id}/cancel` THEN the system SHALL cancel the workflow and all non-terminal tasks that can be safely cancelled.
2. WHEN an operator calls `POST /api/workflows/{workflow_id}/pause` THEN the system SHALL prevent new task claims for that workflow while keeping existing audit state.
3. WHEN an operator calls `POST /api/workflows/{workflow_id}/resume` THEN the system SHALL allow eligible queued tasks to be claimed again.
4. WHEN an operator calls `POST /api/tasks/{task_id}/retry` THEN the system SHALL create or restore a retryable task according to retry policy.
5. WHEN an operator calls `POST /api/tasks/{task_id}/requeue` THEN the system SHALL move an eligible task back to `queued` without changing unrelated tasks.
6. WHEN an operator calls `POST /api/tasks/{task_id}/cancel` THEN the system SHALL cancel only the requested task when state rules allow it.
7. WHEN an operator calls `POST /api/tasks/{task_id}/force-ci-refresh` for a `wait_github_ci` task THEN the system SHALL use stored CI identity to refresh current GitHub status and update the task only if a deterministic result is found.
8. WHEN any control action is called repeatedly with the same idempotency key THEN the system SHOULD return a stable result and SHALL NOT duplicate side effects.

### Requirement 5: Workflow Ownership Policy

**User Story:** As a platform owner, I want explicit role boundaries, so that worker agents cannot accidentally spawn or mutate workflows outside their responsibility.

#### Acceptance Criteria

1. WHEN a workflow is created THEN the system SHALL allow only `orchestrator`, `agent_producer`, `operator`, or `system` roles.
2. WHEN a normal `agent_worker` attempts to create a workflow THEN the system SHALL reject the request.
3. WHEN a next task is created after task completion THEN the system SHALL allow only the state engine/system path to create it.
4. WHEN an agent worker interacts with AgentOps THEN it SHALL be limited to heartbeat, claim, lease renew, lease release, and submit result operations.
5. WHEN an operator action is requested THEN the system SHALL require an `operator` or `system` role.
6. WHEN role metadata is missing in local/dev mode THEN the system SHOULD use a safe default and SHALL document the fallback behavior.

### Requirement 6: Client Callback/Webhook

**User Story:** As an integrating client, I want optional workflow callbacks, so that I can receive terminal or attention events without continuous polling.

#### Acceptance Criteria

1. WHEN a workflow is created with `callback_url` and `callback_events` THEN the system SHALL store the callback configuration in workflow context or a durable callback table.
2. IF `callback_url` is provided THEN the system SHALL validate that it is HTTPS unless local development mode explicitly allows HTTP localhost.
3. WHEN a workflow reaches `succeeded`, `failed`, or `needs_attention` and that event is subscribed THEN the system SHALL attempt callback delivery.
4. WHEN callback delivery fails THEN the system SHALL record the failure and SHOULD retry using bounded retry policy.
5. WHEN callback is not configured THEN the system SHALL preserve polling as the default behavior.
6. WHEN callback payload is sent THEN the system SHALL include compact workflow status and SHALL NOT include secrets or full CI logs.

### Requirement 7: Rich CI Diagnostics

**User Story:** As an agent or operator, I want structured CI failure diagnostics, so that I can understand failed checks and create a targeted `fix_ci` task.

#### Acceptance Criteria

1. WHEN CI fails for a mapped wait task THEN the system SHALL store structured diagnostics including `workflow_run_id`, `run_url`, `failed_jobs`, `failed_steps`, `duration`, and `conclusion` when available.
2. WHEN log excerpts are stored THEN the system SHALL cap excerpt size and redact obvious secrets.
3. WHEN artifacts are available THEN the system SHOULD store artifact metadata and download identifiers, not large artifact binaries, in task result JSON.
4. WHEN a `fix_ci` task is created THEN the system SHALL include the latest CI diagnostics in the task payload.
5. IF GitHub API diagnostics fetch fails THEN the system SHALL preserve the original CI transition and record a diagnostics warning instead of blocking the workflow.

### Requirement 8: Audit Trail and Non-Regression

**User Story:** As a maintainer, I want every important transition recorded, so that workflow behavior is diagnosable and safe to operate.

#### Acceptance Criteria

1. WHEN workflow status, task status, lease state, control action, CI match, callback delivery, or diagnostics state changes THEN the system SHALL write an event/audit record.
2. WHEN Supabase is configured THEN the system SHALL persist workflow/task/event state durably.
3. WHEN Supabase is not configured THEN the system SHALL keep existing in-memory behavior for local development.
4. WHEN new endpoints are added THEN the system SHALL update MCP/REST capabilities or OpenAPI documentation where applicable.
5. WHEN validation runs THEN `npm run typecheck` and `npm run build` SHALL pass before merge.
