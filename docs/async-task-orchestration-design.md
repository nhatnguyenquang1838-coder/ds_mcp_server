# Async Task Orchestration Design

## Execution checklist

- [x] Task 1: Add design and implementation checklist.
- [x] Task 2: Add task/workflow schemas.
- [x] Task 3: Add in-memory task store and state engine MVP.
- [x] Task 4: Add REST task API adapter.
- [ ] Task 5: Add GitHub event ingestion.
- [ ] Task 6: Wire APIs into server router.
- [ ] Task 7: Update README.
- [x] Task 8: Open PR and monitor CI.

## Flow

Web UI or ChatGPT creates a workflow. Agents poll and claim queued tasks. Agents execute MCP, GitHub, or app tools. Agents submit task results. The state engine creates the next task. GitHub event input wakes CI waiting tasks.

## MVP states

queued -> leased -> running -> succeeded
running -> failed
running -> waiting_external
waiting_external -> succeeded
waiting_external -> failed

## MVP task chain

analyze_repo -> plan_changes -> modify_code -> create_pr -> wait_github_ci -> final_report

If CI fails, wait_github_ci creates fix_ci. After fix_ci succeeds, workflow waits for CI again.

## API surface

- POST /api/workflows
- GET /api/workflows/{workflow_id}
- POST /api/async-tasks/claim
- POST /api/async-tasks/{task_id}/result

## Design decision

External CI event input is the primary CI signal. Polling is only fallback reconciliation.

## Implementation note

The current branch includes the in-memory store, schemas, and REST API adapter. The server router wiring is kept as a separate task because server.ts is large and must be patched carefully.
