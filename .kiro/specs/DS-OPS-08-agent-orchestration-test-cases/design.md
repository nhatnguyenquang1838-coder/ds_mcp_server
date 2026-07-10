# Design Document

## Overview

This design defines how to add focused tests around DS MCP AgentOps orchestration without changing runtime behavior. The test work should cover the current implementation surfaces first, then mark gaps where the Phase 7 design expects stronger behavior than the current code provides.

The current implementation has these relevant surfaces:

- `src/asyncWorkflowStore.ts` owns memory fallback workflow creation, task claiming, result submission, next-task creation, and GitHub CI event handling.
- `src/agentops/claimTargeting.ts` owns targeted claim filter matching and non-retryable claim failure classification.
- `src/state/stateEngine.ts` owns Supabase-mode next task, retry, and dead-letter transitions.
- `src/agentops/router.ts` owns REST route parsing, schema validation, webhook signature handling, and response codes.
- `src/repositories/orchestrationRepository.ts` owns Supabase persistence, task claiming, retry, dead-letter, webhook delivery, and wait-task lookup.
- `package.json` already exposes `npm test` as `tsx --test test/*.test.ts`.

Non-goals:

- No production code changes unless tests expose a compile blocker or impossible-to-test boundary.
- No live GitHub Actions calls.
- No live Supabase dependency for default test execution.
- No dashboard redesign.

## Architecture

```txt
npm test
  -> test/*.test.ts
      -> pure unit tests
          -> claimTargeting
          -> stateEngine/evaluateNextTaskType
      -> memory integration tests
          -> asyncWorkflowStore memory fallback
          -> GitHub CI event handler duplicate/match behavior
      -> router contract tests
          -> handleAgentOpsRestApi with mocked deps
      -> repository boundary tests
          -> mocked Supabase client where practical
```

Recommended test file split:

```txt
test/claimTargeting.test.ts
test/asyncWorkflowStore.memory.test.ts
test/stateEngine.test.ts
test/githubCiWebhook.test.ts
test/agentopsRouter.test.ts
test/orchestrationRepository.test.ts
```

## Components and Interfaces

### ClaimTargetingTests

Suggested path:

```txt
test/claimTargeting.test.ts
```

Responsibility:

- Verify `taskMatchesClaimFilters` against task-only context, workflow-only context, and merged context.
- Verify `claimFilterSnapshot` preserves target filters for audit events.
- Verify `isNonRetryableClaimFailureReason` accepts only the configured wrong-claim reasons.

Interface:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  claimFilterSnapshot,
  isNonRetryableClaimFailureReason,
  taskMatchesClaimFilters
} from "../src/agentops/claimTargeting.js";
```

Existing shared components to reuse:

- `AsyncTask` and `AsyncWorkflow` type shapes from `src/asyncWorkflowStore.ts`.
- Small fixture builders local to the test file.

### AsyncWorkflowStoreMemoryTests

Suggested path:

```txt
test/asyncWorkflowStore.memory.test.ts
```

Responsibility:

- Verify memory fallback workflow creation and task lifecycle.
- Verify targeted claims in memory fallback.
- Verify task result submission creates expected next tasks.
- Verify final report completion sets workflow status to `succeeded`.
- Verify CI event handling by `wait_key`, duplicate delivery handling, and no-match handling.

Interface:

```ts
import {
  claimAsyncTask,
  createAsyncWorkflow,
  getAsyncWorkflow,
  handleGithubCiEvent,
  submitAsyncTaskResult
} from "../src/asyncWorkflowStore.js";
```

Existing shared components to reuse:

- App config fixture with Supabase disabled.
- Current public functions; avoid importing private module maps.

Test isolation note:

- `asyncWorkflowStore.ts` keeps module-level memory maps. Tests must avoid assertions that depend on a globally empty store unless the implementation adds a test-only reset helper. Safer test cases should use unique workflow names/context and targeted claim filters to isolate each case.

### StateEngineTests

Suggested path:

```txt
test/stateEngine.test.ts
```

Responsibility:

- Verify pure `evaluateNextTaskType` transitions.
- Verify `applyTaskResultTransition` for retry, dead-letter, final success, and next task creation using mocked repository functions if current module structure permits.

Interface:

```ts
import {
  applyTaskResultTransition,
  evaluateNextTaskType
} from "../src/state/stateEngine.js";
```

Existing shared components to reuse:

- `AsyncTask` type shape from `src/asyncWorkflowStore.ts`.
- Repository boundary stubs or a small dependency-injection refactor only if needed.

### GithubCiWebhookTests

Suggested path:

```txt
test/githubCiWebhook.test.ts
```

Responsibility:

- Verify GitHub webhook normalization for final/ignored events.
- Verify invalid JSON handling at router boundary when routed through `handleAgentOpsRestApi`.
- Verify signature rejection when `githubWebhookSecret` is configured.

Interface:

```ts
import {
  normalizeGithubCiWebhook,
  parseGithubWebhookBody,
  verifyGithubWebhookSignature
} from "../src/agentops/githubWebhook.js";
```

Existing shared components to reuse:

- Node `crypto` HMAC helper for valid/invalid signature fixtures.
- Small GitHub event payload fixtures for `workflow_run`, `check_run`, `check_suite`, and `status`.

### AgentOpsRouterTests

Suggested path:

```txt
test/agentopsRouter.test.ts
```

Responsibility:

- Verify route recognition and response codes.
- Verify Zod validation errors for bad workflow, claim, result, scheduler, and webhook payloads.
- Verify successful route body shape for workflow creation, task claim, task result, and ignored GitHub webhook.

Interface:

```ts
import { handleAgentOpsRestApi } from "../src/agentops/router.js";
```

Mock harness shape:

```ts
type SendJsonCall = {
  statusCode: number;
  body: unknown;
};

type RouterHarness = {
  calls: SendJsonCall[];
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  setCorsHeaders: (res: ServerResponse) => void;
  readJsonBody: () => Promise<unknown>;
  readRawBody: () => Promise<Buffer>;
};
```

Existing shared components to reuse:

- Current router dependency injection through `AgentOpsRouterDeps`.
- Minimal fake `IncomingMessage` and `ServerResponse` objects if strict typing allows; otherwise use Node test helpers.

### OrchestrationRepositoryBoundaryTests

Suggested path:

```txt
test/orchestrationRepository.test.ts
```

Responsibility:

- Verify retry delay computation with pure `computeRetryRunAfter`.
- Verify Supabase query/update call intent for claim, retry, dead-letter, webhook delivery, and wait-task lookup using a fake Supabase client if practical.
- Document any repository functions that remain better covered by integration tests.

Interface:

```ts
import {
  computeRetryRunAfter
} from "../src/repositories/orchestrationRepository.js";
```

Existing shared components to reuse:

- Pure function tests first.
- Avoid live Supabase for default test run.

## Data Models

### TestWorkflowFixture

```ts
type TestWorkflowFixture = {
  id: string;
  name: string;
  source: "web" | "chatgpt" | "system";
  status: "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  current_task_id?: string;
  context_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

Mapping rules:

- Use realistic `context_json` fields: `repo`, `repo_owner`, `repo_name`, `branch`, `repo_branch`, `pr_number`, `head_sha`.
- Prefer unique workflow names and branches per test case.

### TestTaskFixture

```ts
type TestTaskFixture = {
  id: string;
  workflow_id: string;
  parent_task_id?: string;
  type: "analyze_repo" | "plan_changes" | "modify_code" | "create_pr" | "wait_github_ci" | "fix_ci" | "final_report";
  status: "queued" | "leased" | "running" | "waiting_external" | "succeeded" | "failed" | "cancelled" | "dead_letter";
  payload_json: Record<string, unknown>;
  result_json?: Record<string, unknown>;
  error_json?: Record<string, unknown>;
  lease_owner?: string;
  lease_expires_at?: string;
  wait_key?: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
};
```

Mapping rules:

- Tests that assert claim filtering should include overlapping candidate tasks with the same capability but different workflow/repo/branch/PR metadata.
- Tests that assert CI matching should include `wait_github_ci` tasks with unique and duplicate wait keys.

### RouterResponseFixture

```ts
type RouterResponseFixture = {
  statusCode: number;
  body: unknown;
};
```

Mapping rules:

- Assert response body shape, not full object equality, when generated IDs or timestamps are present.
- Assert exact error text only for stable public errors such as `Invalid JSON body` and `Invalid AgentOps payload`.

### TestCaseMatrixRow

```ts
type TestCaseMatrixRow = {
  area: "workflow" | "claim" | "state_engine" | "ci" | "router" | "repository";
  scenario: string;
  expected_property: string;
  mode: "memory" | "mocked_supabase" | "pure" | "router";
  required: boolean;
};
```

Mapping rules:

- Each implemented test should map to at least one matrix row in test comments or a small `docs` section if added.
- Pending/skipped tests must include a reason and a follow-up pointer.

## Correctness Properties

### Workflow sequencing

A successful task must create at most one next task.

A `final_report` success must mark the workflow as succeeded and must not create another task.

A failed `wait_github_ci` task must route to `fix_ci`; a successful `wait_github_ci` task must route to `final_report`.

### Claim safety

Supplying target filters must narrow the claim set; it must never broaden it.

A task that does not match `task_id`, `workflow_id`, repo, branch, or PR filters must not be leased.

Claim filters written into audit events must reflect the input filters used for the claim.

### Retry and dead-letter behavior

Non-retryable claim failures must not schedule retry.

Retryable failures below limit must not move directly to dead-letter.

Retry-exhausted tasks must not remain claimable.

### CI handling

Duplicate webhook delivery IDs must not transition the same wait task twice.

A no-match CI event must not modify unrelated waiting tasks.

Ambiguous CI matches should be documented as a known risk if the current implementation does not protect against them.

### Router behavior

Schema-invalid requests must fail before mutating orchestration state.

Webhook signature failure must return unauthorized before parsing or applying CI transitions.

Unknown AgentOps routes must return 404 and must not fall through to unrelated route handlers.

## Error Handling

- Invalid JSON tests should assert a `400` response and avoid relying on engine-specific parse messages.
- Zod validation tests should assert top-level error contract and presence of details.
- Missing workflow/task tests should assert `404` response shape.
- Ambiguous CI behavior should be handled as either an expected pending/skipped test or a failing regression test depending on project convention.
- Tests that need mocking but cannot safely mock ESM imports should be split into pure-function tests and documented follow-up refactor tasks.

## Testing Strategy

Required validation commands:

```bash
npm run typecheck
npm run build
npm test
```

Recommended implementation order:

1. Add pure tests first: `claimTargeting`, `evaluateNextTaskType`, `computeRetryRunAfter`.
2. Add memory fallback tests for workflow lifecycle and targeted claim behavior.
3. Add GitHub CI handler tests for duplicate/no-match/match behavior.
4. Add router contract tests with mocked dependencies.
5. Add repository boundary tests only where stable without live Supabase.
6. Add skipped/pending regression cases for behavior that Phase 7 requires but current code does not yet implement.

Required test categories:

| Area | Minimum cases |
|---|---:|
| Workflow lifecycle | 6 |
| Targeted claim | 8 |
| State engine retry/dead-letter | 5 |
| GitHub CI webhook/matching | 7 |
| Router validation | 7 |
| Repository boundary | 3 |

## Implementation Constraints

- Do not touch unrelated DS MCP functionality.
- Do not call live Supabase from default tests.
- Do not call live GitHub from default tests.
- Do not add destructive GitHub operation coverage because destructive endpoints are intentionally not exposed.
- Keep fixtures small and free of secrets.
- Keep test file names under `test/*.test.ts` so the existing `npm test` script discovers them.
- Prefer Node built-in `node:test` and `node:assert/strict`; do not add a new test framework unless necessary.
- If implementation needs a reset helper for memory fallback, keep it clearly test-only and do not expose it through REST/MCP APIs.
- Run validation honestly and report any skipped tests or known gaps.
