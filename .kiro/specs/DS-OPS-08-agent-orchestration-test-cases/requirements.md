# Requirements Document

## Introduction

This spec defines the test-case work needed to harden DS MCP AgentOps orchestration logic. The current code already supports async workflow creation, task claiming, result submission, state-engine transitions, GitHub CI webhook handling, scheduler support, and Supabase/in-memory dual behavior. The target outcome is a focused test suite that proves the orchestration flow is deterministic, safe against wrong task claims, resilient to duplicate/ambiguous CI events, and honest about persistence fallback behavior.

Non-goals:

- Do not implement new AgentOps product behavior in this spec.
- Do not redesign the dashboard or API surface.
- Do not introduce destructive GitHub operations.
- Do not require live GitHub, live Supabase, or external network calls for the default test run.
- Do not store secrets or large CI logs in test fixtures.

## Glossary

| Term | Definition |
|---|---|
| AgentOps | DS MCP orchestration layer for async workflows, agent task claims, leases, state transitions, scheduler events, and GitHub CI callbacks. |
| Workflow | Parent orchestration record that tracks async task progression and overall status. |
| Async task | Queueable unit of work handled by an agent or state-engine path. |
| State engine | Server-side logic that creates the next async task after a task result is submitted. |
| Targeted claim | Task claim constrained by task, workflow, repo, branch, or PR metadata. |
| Wrong-claim safety | Protection that prevents an agent from claiming or retrying work for the wrong target. |
| Wait CI task | `wait_github_ci` task that waits for external GitHub CI completion. |
| Webhook delivery | GitHub CI/status callback event identified by `delivery_id`. |
| Memory fallback | Local in-memory orchestration behavior used when Supabase is not configured. |
| Supabase mode | Durable orchestration behavior used when Supabase configuration is present. |

## Requirements

### Requirement 1: Workflow Lifecycle Test Coverage

**User Story:** As a DS MCP maintainer, I want workflow lifecycle tests, so that regressions in task sequencing are caught before AgentOps is used by coding agents.

#### Acceptance Criteria

1. WHEN a workflow is created without Supabase configured THEN the test suite SHALL assert that a workflow and first async task are created with expected IDs, status, context, and current task linkage.
2. WHEN a successful task result is submitted for each normal task type THEN the test suite SHALL assert the next task type follows the expected sequence: `analyze_repo` to `plan_changes` to `modify_code` to `create_pr` to `wait_github_ci` to `final_report`.
3. WHEN a `wait_github_ci` task succeeds THEN the test suite SHALL assert that `final_report` is created and the workflow can transition to `succeeded` after final report completion.
4. WHEN a `wait_github_ci` task fails THEN the test suite SHALL assert that `fix_ci` is created and the workflow remains recoverable.
5. WHEN a task has no valid next task THEN the test suite SHALL assert no unexpected task is created.
6. WHEN lifecycle transitions occur THEN the test suite SHALL assert relevant events are recorded where current storage mode exposes events.

### Requirement 2: Targeted Claim and Wrong-Claim Safety Tests

**User Story:** As an agent worker, I want claim filtering tests, so that I only claim work intended for my target workflow, repository, branch, or PR.

#### Acceptance Criteria

1. WHEN a claim request includes `task_id` THEN the test suite SHALL assert only that exact task can be leased when type and status are eligible.
2. WHEN a claim request includes `workflow_id` THEN the test suite SHALL assert only tasks under that workflow can be leased.
3. WHEN a claim request includes `repo`, `repo_owner`, `repo_name`, `branch`, `repo_branch`, or `pr_number` THEN the test suite SHALL assert filters are evaluated against merged workflow context and task payload metadata.
4. WHEN no task matches supplied filters THEN the test suite SHALL assert the claim returns `undefined` or `null` and MUST NOT fall back to unrelated capability-only tasks.
5. WHEN a queued task and an expired leased task are both eligible THEN the test suite SHOULD assert deterministic ordering based on current implementation rules.
6. WHEN a targeted claim succeeds THEN the test suite SHALL assert `task_claimed` audit data includes the supplied claim filters where event access exists.
7. WHEN task failure reason is `wrong_task_claimed`, `claim_filter_mismatch`, or `claim_target_mismatch` THEN the test suite SHALL assert the failure is treated as non-retryable and does not enter a retry loop.

### Requirement 3: State Engine Retry and Dead-Letter Tests

**User Story:** As a platform owner, I want retry and dead-letter tests, so that failed agent tasks do not loop forever or silently corrupt workflow state.

#### Acceptance Criteria

1. WHEN a retryable task fails below retry limit THEN the test suite SHALL assert a retry is scheduled and workflow status remains recoverable.
2. WHEN a task exceeds retry policy attempts THEN the test suite SHALL assert it moves to `dead_letter` and workflow status becomes failed.
3. WHEN a non-retryable claim failure occurs THEN the test suite SHALL assert the task moves directly to `dead_letter` without scheduling retry.
4. WHEN a final report succeeds THEN the test suite SHALL assert workflow status becomes `succeeded` and current task is cleared where current implementation supports it.
5. WHEN state-engine transition events are emitted THEN the test suite SHALL assert event type, actor, and core data fields.

### Requirement 4: GitHub CI Webhook and Matching Tests

**User Story:** As the AgentOps CI handler, I want webhook matching tests, so that CI callbacks resume only the correct waiting tasks and duplicate deliveries are safe.

#### Acceptance Criteria

1. WHEN a GitHub CI event has a new `delivery_id` and matches a `wait_github_ci` task by `head_sha` THEN the test suite SHALL assert exactly one matching task is transitioned.
2. WHEN a GitHub CI event has a new `delivery_id` and matches by `pr_number` THEN the test suite SHALL assert matching behavior follows the current wait-key implementation.
3. WHEN the same `delivery_id` is received twice THEN the test suite SHALL assert the second event is ignored and does not transition any task again.
4. WHEN no waiting task matches the CI event THEN the test suite SHALL assert no task is changed and the handler reports zero matches.
5. WHEN multiple waiting tasks match the same CI event THEN the test suite SHALL document the current behavior and include a pending or failing regression test if deterministic ambiguity protection is not implemented yet.
6. WHEN a GitHub webhook payload is non-final or unsupported THEN router-level tests SHALL assert it is ignored with an accepted response.
7. WHEN webhook signature verification is configured THEN router-level tests SHALL assert invalid signatures are rejected without calling state transition logic.

### Requirement 5: Router Schema and API Error Tests

**User Story:** As an API consumer, I want AgentOps router tests, so that bad requests fail predictably and valid orchestration routes stay stable.

#### Acceptance Criteria

1. WHEN an AgentOps path is not recognized THEN the test suite SHALL assert a `404` response with a clear error body.
2. WHEN request JSON is invalid THEN the test suite SHALL assert a `400` response with `Invalid JSON body`.
3. WHEN request payload violates Zod schema THEN the test suite SHALL assert a `400` response with `Invalid AgentOps payload` and details.
4. WHEN `POST /api/workflows` receives valid input THEN the test suite SHALL assert response status `202` and expected workflow/task body shape.
5. WHEN `POST /api/async-tasks/claim` receives valid targeted claim input THEN the test suite SHALL assert the claim schema accepts target filters and returns stable response shape.
6. WHEN `POST /api/async-tasks/{task_id}/result` targets a missing task THEN the test suite SHALL assert a `404` response.
7. WHEN `POST /api/webhooks/github` receives an ignored event THEN the test suite SHALL assert response body includes `ignored: true` and a reason.

### Requirement 6: Persistence Boundary and Test Harness

**User Story:** As a maintainer, I want isolated tests for memory fallback and repository boundaries, so that tests are fast locally and can later be extended to Supabase mode.

#### Acceptance Criteria

1. WHEN Supabase is not configured THEN the default test suite SHALL run without external services.
2. WHEN tests need durable repository behavior THEN the implementation SHALL use stubs, fakes, or narrow mock adapters rather than live Supabase by default.
3. WHEN Supabase-specific repository functions are tested THEN the test suite SHOULD isolate query/update behavior through mocked Supabase client responses.
4. WHEN tests mutate in-memory module state THEN the test suite SHALL isolate cases to prevent cross-test contamination.
5. WHEN test fixtures are created THEN they SHALL avoid secrets, large payloads, and network-dependent data.
6. WHEN validation is run THEN `npm run typecheck`, `npm run build`, and `npm test` SHALL pass or failures SHALL be reported honestly.

### Requirement 7: CI-Focused Regression Matrix

**User Story:** As a delivery owner, I want a regression matrix for orchestration edge cases, so that future AgentOps changes can be planned and validated safely.

#### Acceptance Criteria

1. WHEN test tasks are implemented THEN the test suite SHALL include a documented matrix covering happy path, failure path, retry path, duplicate event path, wrong-claim path, and router validation path.
2. WHEN a currently missing behavior is discovered THEN the task SHALL mark the test as pending/skipped with a clear TODO or split a follow-up implementation spec.
3. WHEN behavior differs between memory fallback and Supabase mode THEN the test SHALL document the difference rather than hiding it.
4. WHEN a regression test is added for a known bug THEN the test name SHALL describe the scenario and expected safety property.
5. WHEN final reporting is prepared THEN it SHALL list tests added, risks found, and behaviors intentionally not covered.
