# Design Document

## Overview

Phase 7 introduces control-plane hardening around the existing AgentOps MVP. The design keeps the current HTTP server, AgentOps router, async workflow store, state engine, scheduler, GitHub gateway, and Supabase/in-memory dual mode. It adds compact workflow status reads, deterministic CI identity matching, explicit lease lifecycle APIs, operator control actions, role-based ownership policy, optional client callbacks, and structured CI diagnostics.

Non-goals:

- No dashboard visual redesign in this spec.
- No destructive GitHub write operations.
- No replacement of the existing `xstate`/state-engine direction.
- No unbounded log/artifact storage.

## Architecture

```txt
Client / Dashboard / Agent
  -> src/server.ts
  -> src/agentops/router.ts
      -> workflowStatusService
      -> claimTargetingService
      -> leaseService
      -> controlActionService
      -> ownershipPolicy
      -> callbackService
      -> ciDiagnosticsService
      -> asyncWorkflowStore / stateEngine
      -> repositories/orchestrationRepository
      -> GitHub gateway client
      -> Supabase when configured, memory store for local fallback
```

Primary routes to add or extend:

```txt
GET  /api/workflows/{workflow_id}/status
POST /api/async-tasks/{task_id}/lease/renew
POST /api/async-tasks/{task_id}/lease/release
POST /api/scheduler/recover-expired-leases
POST /api/workflows/{workflow_id}/cancel
POST /api/workflows/{workflow_id}/pause
POST /api/workflows/{workflow_id}/resume
POST /api/tasks/{task_id}/retry
POST /api/tasks/{task_id}/requeue
POST /api/tasks/{task_id}/cancel
POST /api/tasks/{task_id}/force-ci-refresh
```

Existing routes to extend:

```txt
POST /api/workflows
GET  /api/workflows/{workflow_id}
POST /api/async-tasks/claim
POST /api/async-tasks/{task_id}/result
POST /api/webhooks/github
GET  /api/capabilities
```

## Components and Interfaces

### AgentOpsRouter

Suggested path:

```txt
src/agentops/router.ts
```

Responsibility:

- Route new Phase 7 endpoints.
- Parse request bodies with Zod schemas.
- Delegate domain behavior to services.
- Preserve current REST authorization behavior.
- Keep route handling thin.

Interface:

```ts
export async function handleAgentOpsRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AgentOpsRouterDeps
): Promise<boolean>;
```

### WorkflowStatusService

Suggested path:

```txt
src/agentops/workflowStatusService.ts
```

Responsibility:

- Build compact workflow status from workflow, task, event, lease, and attention state.
- Avoid loading or returning heavy task/event payloads when Supabase supports targeted queries.
- Provide the response model for polling clients.

Interface:

```ts
export type WorkflowStatusResponse = {
  workflow_id: string;
  status: AsyncWorkflowStatus | "paused";
  current_task?: {
    id: string;
    type: AsyncTaskType;
    status: AsyncTaskStatus;
    lease_expires_at?: string;
    needs_attention?: boolean;
  };
  progress: {
    done: number;
    total: number;
  };
  needs_attention: boolean;
  attention_reasons?: string[];
  updated_at: string;
};

export async function getWorkflowStatus(
  config: AppConfig,
  workflowId: string
): Promise<WorkflowStatusResponse | undefined>;
```

### CiIdentityService

Suggested path:

```txt
src/agentops/ciIdentity.ts
```

Responsibility:

- Normalize CI identity from task payloads, PR creation result artifacts, and GitHub webhook payloads.
- Match CI events to wait tasks using deterministic precedence.
- Detect ambiguous matches.

Interface:

```ts
export type CiIdentity = {
  repo: string;
  pr_number?: number;
  head_sha?: string;
  workflow_run_id?: number;
  check_suite_id?: number;
  check_run_id?: number;
};

export type CiMatchResult =
  | { status: "matched"; task_id: string; precedence: string }
  | { status: "none" }
  | { status: "ambiguous"; task_ids: string[]; precedence: string };

export function normalizeCiIdentity(input: Record<string, unknown>): CiIdentity | undefined;
export function matchWaitingCiTask(input: {
  event_identity: CiIdentity;
  waiting_tasks: AsyncTask[];
}): CiMatchResult;
```

### ClaimTargetingService

Suggested path:

```txt
src/agentops/claimTargetingService.ts
```

Responsibility:

- Normalize targeted claim filters from `POST /api/async-tasks/claim`.
- Merge workflow context and task payload metadata before filter evaluation.
- Prevent fallback to unrelated capability-only tasks when target filters are supplied.
- Emit claim filters into `task_claimed` audit events for traceability.
- Classify `wrong_task_claimed`, `claim_filter_mismatch`, and `claim_target_mismatch` as non-retryable failures.

Interface:

```ts
export type AsyncTaskClaimInput = {
  agent_id: string;
  capabilities: AsyncTaskType[];
  lease_seconds?: number;
  task_id?: string;
  workflow_id?: string;
  repo?: string;
  repo_owner?: string;
  repo_name?: string;
  branch?: string;
  repo_branch?: string;
  pr_number?: number;
};

export function taskMatchesClaimFilters(input: {
  task: AsyncTask;
  workflow?: AsyncWorkflow;
  claim: AsyncTaskClaimInput;
}): boolean;

export function isNonRetryableClaimFailure(reason?: string): boolean;
```

### LeaseService

Suggested path:

```txt
src/agentops/leaseService.ts
```

Responsibility:

- Renew active task lease by owner.
- Release active task lease by owner.
- Recover expired leases through scheduler path.
- Apply retry/dead-letter rules consistently across memory and Supabase modes.

Interface:

```ts
export type LeaseRenewInput = {
  agent_id: string;
  lease_seconds?: number;
  idempotency_key?: string;
};

export type LeaseReleaseInput = {
  agent_id: string;
  reason?: string;
  idempotency_key?: string;
};

export async function renewTaskLease(
  config: AppConfig,
  taskId: string,
  input: LeaseRenewInput
): Promise<AsyncTask | undefined>;

export async function releaseTaskLease(
  config: AppConfig,
  taskId: string,
  input: LeaseReleaseInput
): Promise<AsyncTask | undefined>;

export async function recoverExpiredLeases(
  config: AppConfig,
  schedulerId: string
): Promise<{ recovered: number; dead_lettered: number }>;
```

### ControlActionService

Suggested path:

```txt
src/agentops/controlActionService.ts
```

Responsibility:

- Implement workflow cancel/pause/resume.
- Implement task retry/requeue/cancel/force-ci-refresh.
- Enforce state constraints before mutation.
- Write audit events for all operator actions.

Interface:

```ts
export type OperatorActionInput = {
  actor_id?: string;
  role: AgentOpsRole;
  reason?: string;
  idempotency_key?: string;
};

export async function cancelWorkflow(config: AppConfig, workflowId: string, input: OperatorActionInput): Promise<unknown>;
export async function pauseWorkflow(config: AppConfig, workflowId: string, input: OperatorActionInput): Promise<unknown>;
export async function resumeWorkflow(config: AppConfig, workflowId: string, input: OperatorActionInput): Promise<unknown>;
export async function retryTask(config: AppConfig, taskId: string, input: OperatorActionInput): Promise<unknown>;
export async function requeueTask(config: AppConfig, taskId: string, input: OperatorActionInput): Promise<unknown>;
export async function cancelTask(config: AppConfig, taskId: string, input: OperatorActionInput): Promise<unknown>;
export async function forceCiRefresh(config: AppConfig, taskId: string, input: OperatorActionInput): Promise<unknown>;
```

### OwnershipPolicy

Suggested path:

```txt
src/agentops/ownershipPolicy.ts
```

Responsibility:

- Centralize role checks for workflow creation, next-task creation, claim, submit, lease, and operator actions.
- Prevent worker agents from creating workflows unless role is `agent_producer`.

Interface:

```ts
export type AgentOpsRole = "orchestrator" | "agent_worker" | "agent_producer" | "operator" | "system";
export type AgentOpsAction =
  | "workflow:create"
  | "task:create_next"
  | "task:claim"
  | "task:submit_result"
  | "lease:renew"
  | "lease:release"
  | "operator:control";

export function assertAllowedRole(role: AgentOpsRole, action: AgentOpsAction): void;
```

### ClientCallbackService

Suggested path:

```txt
src/agentops/clientCallbackService.ts
```

Responsibility:

- Validate callback configuration on workflow creation.
- Dispatch subscribed workflow events.
- Record callback delivery success/failure and retry metadata.

Interface:

```ts
export type CallbackEvent = "succeeded" | "failed" | "needs_attention";

export type WorkflowCallbackConfig = {
  callback_url: string;
  callback_events: CallbackEvent[];
};

export async function maybeDispatchWorkflowCallback(input: {
  config: AppConfig;
  workflow_id: string;
  event: CallbackEvent;
  status: WorkflowStatusResponse;
}): Promise<void>;
```

### CiDiagnosticsService

Suggested path:

```txt
src/agentops/ciDiagnosticsService.ts
```

Responsibility:

- Enrich failed CI events with structured GitHub run/job/step/artifact metadata.
- Preserve transition if diagnostics fetching fails.
- Cap and redact log excerpts.

Interface:

```ts
export type CiDiagnostics = {
  workflow_run_id?: number;
  run_url?: string;
  failed_jobs?: Array<{
    name: string;
    conclusion?: string;
    failed_steps?: Array<{ name: string; conclusion?: string; number?: number }>;
  }>;
  log_excerpt?: string;
  artifacts?: Array<{ id: number; name: string; size_in_bytes?: number; expired?: boolean }>;
  duration_ms?: number;
  conclusion?: string;
  warnings?: string[];
};

export async function collectCiDiagnostics(
  config: AppConfig,
  identity: CiIdentity
): Promise<CiDiagnostics>;
```

### OrchestrationRepository

Suggested path:

```txt
src/repositories/orchestrationRepository.ts
```

Responsibility:

- Add durable queries and updates required by status, CI identity, lease lifecycle, control actions, callback state, diagnostics, and idempotency.
- Preserve existing Supabase-configured behavior and local memory fallback behavior.

Interface examples:

```ts
export async function getWorkflowStatusRecord(config: AppConfig, workflowId: string): Promise<WorkflowStatusResponse | undefined>;
export async function findWaitingGithubTasksByIdentity(config: AppConfig, identity: CiIdentity): Promise<AsyncTask[]>;
export async function renewLeaseRecord(config: AppConfig, taskId: string, input: LeaseRenewInput): Promise<AsyncTask | undefined>;
export async function recoverExpiredLeaseRecords(config: AppConfig, schedulerId: string): Promise<{ recovered: number; dead_lettered: number }>;
```

## Data Models

### WorkflowStatusResponse

```ts
type WorkflowStatusResponse = {
  workflow_id: string;
  status: "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "paused";
  current_task?: {
    id: string;
    type: AsyncTaskType;
    status: AsyncTaskStatus;
    lease_expires_at?: string;
    needs_attention?: boolean;
  };
  progress: {
    done: number;
    total: number;
  };
  needs_attention: boolean;
  attention_reasons?: string[];
  updated_at: string;
};
```

### CiIdentity

```ts
type CiIdentity = {
  repo: string;
  pr_number?: number;
  head_sha?: string;
  workflow_run_id?: number;
  check_suite_id?: number;
  check_run_id?: number;
};
```

Mapping rules:

1. Store CI identity under `task.payload_json.ci_identity` for `wait_github_ci` tasks.
2. Keep `wait_key` only as backward-compatible legacy metadata.
3. Match by strongest deterministic key first.
4. Never fall back to `pr_number` without matching `repo`.
5. Treat multiple same-precedence matches as ambiguous.

### AsyncTaskClaimInput

```ts
type AsyncTaskClaimInput = {
  agent_id: string;
  capabilities: AsyncTaskType[];
  lease_seconds?: number;
  task_id?: string;
  workflow_id?: string;
  repo?: string;
  repo_owner?: string;
  repo_name?: string;
  branch?: string;
  repo_branch?: string;
  pr_number?: number;
};
```

Mapping rules:

1. `task_id` is the strongest target and must not fall back to any other task.
2. `workflow_id` limits claims to tasks inside that workflow.
3. Repository filters match against merged workflow context and task payload metadata.
4. `branch` and `repo_branch` are equivalent claim aliases; persisted context may use `work_branch`, `repo_branch`, or `branch`.
5. If any supplied filter does not match, the candidate task is skipped.
6. If no candidate matches, the claim returns no task rather than claiming an unrelated capability-only task.

### Lease State

```ts
type LeaseState = {
  lease_owner?: string;
  lease_expires_at?: string;
  retry_count: number;
  max_retries: number;
};
```

Mapping rules:

- `queued` tasks may be claimed.
- `leased` or `running` tasks may be renewed only by owner.
- Expired leased/running tasks may be recovered by scheduler.
- Over-retried tasks move to `dead_letter`.

### AgentOpsRole

```ts
type AgentOpsRole = "orchestrator" | "agent_worker" | "agent_producer" | "operator" | "system";
```

Role mapping:

| Action | Allowed roles |
|---|---|
| Create workflow | `orchestrator`, `agent_producer`, `operator`, `system` |
| Create next task | `system` |
| Claim task | `agent_worker`, `agent_producer`, `system` |
| Submit result | `agent_worker`, `agent_producer`, `system` |
| Renew/release lease | `agent_worker`, `agent_producer`, `system` |
| Operator control | `operator`, `system` |

### WorkflowCallbackConfig

```ts
type WorkflowCallbackConfig = {
  callback_url: string;
  callback_events: Array<"succeeded" | "failed" | "needs_attention">;
  last_delivery_at?: string;
  last_delivery_status?: "succeeded" | "failed";
  retry_count?: number;
};
```

### CiDiagnostics

```ts
type CiDiagnostics = {
  workflow_run_id?: number;
  run_url?: string;
  failed_jobs?: Array<{
    name: string;
    conclusion?: string;
    failed_steps?: Array<{ name: string; conclusion?: string; number?: number }>;
  }>;
  log_excerpt?: string;
  artifacts?: Array<{ id: number; name: string; size_in_bytes?: number; expired?: boolean }>;
  duration_ms?: number;
  conclusion?: string;
  warnings?: string[];
};
```

## Correctness Properties

### Compact status invariants

- Compact status must not return full task payloads or full event lists.
- `progress.done` must never exceed `progress.total`.
- Missing tasks must not make a workflow appear successful.
- Any failed/dead-letter/ambiguous/exceeded-lease condition must set `needs_attention`.

### CI mapping invariants

- A GitHub CI event must never complete a wait task from a different repo.
- A stronger identity match must take priority over a weaker identity match.
- Ambiguous matches must not transition tasks.
- Duplicate delivery IDs must not create duplicate task transitions.

### Claim targeting invariants

- A targeted claim must never lease a task outside the requested `task_id`, `workflow_id`, repository, branch, or PR filter.
- Capability-only claim remains valid only when no target filters are supplied.
- A target filter mismatch must skip the candidate task instead of relaxing the filter.
- A wrong-task claim failure must not enter the retry loop.
- `wrong_task_claimed`, `claim_filter_mismatch`, and `claim_target_mismatch` failures must move to `dead_letter` or another explicitly non-retryable terminal recovery state.
- `task_claimed` audit events must include the filters used for claim decisions.

### Lease invariants

- Only the current lease owner can renew or release a live lease.
- An expired lease may be recovered only by scheduler/system path.
- A task past `max_retries` must not be requeued silently.

### Ownership invariants

- Worker agents must not create workflows.
- Next tasks must be created by state engine/system path only.
- Operator actions must not bypass task state constraints.

### CI diagnostics invariants

- Diagnostics failure must not block the base CI status transition.
- Stored log excerpts must be bounded and redacted.
- Artifact binaries must not be persisted in workflow/task state.

## Error Handling

- Return `400` for invalid request body or unsupported enum values.
- Return `401` when REST bearer authorization fails.
- Return `403` when role policy denies the action.
- Return `404` when workflow/task is not found.
- Return `409` for invalid state transition, non-owner lease renew/release, ambiguous CI mapping, or targeted claim conflict when an exact target is not claimable.
- Return `422` when callback URL or CI identity is structurally invalid.
- Return `502` only for external GitHub/callback fetch failures that prevent an explicit force-refresh result.
- Always write an audit event for rejected operator actions when actor context is available.

## Testing Strategy

Unit tests:

- Workflow status projection from workflow/task/event fixtures.
- CI identity normalization and match precedence.
- Ambiguous CI match handling.
- Targeted claim filter matching for task, workflow, repo, branch, and PR metadata.
- Non-retryable wrong-claim failure handling.
- Lease renew/release ownership rules.
- Expired lease recovery retry/dead-letter behavior.
- Ownership policy allow/deny matrix.
- Callback URL validation.
- CI diagnostics redaction and size cap.

Integration tests:

- `GET /api/workflows/{workflow_id}/status` after workflow creation and task completion.
- `POST /api/webhooks/github` maps to exactly one waiting task by structured identity.
- Lease renew/release/recover routes mutate state correctly.
- Dashboard control actions write events and respect state constraints.
- Supabase-configured path and memory fallback path remain behaviorally consistent where practical.

Validation commands:

```bash
npm run typecheck
npm run build
```

## Implementation Constraints

- Do not touch unrelated files.
- Do not write directly to protected branches.
- Keep new write operations guarded, schema-validated, and idempotent where practical.
- Keep current memory fallback behavior for local development.
- Use Supabase repositories when Supabase is configured.
- Do not store secrets in logs, events, callback payloads, CI excerpts, or artifacts.
- Do not expose merge/delete/force-push/secret-management endpoints.
- Keep route handlers thin and move domain logic into testable services.
- Update `/api/capabilities` and OpenAPI documentation when routes are added.
