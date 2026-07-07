# Async Task Orchestration Design

## Execution checklist

- [x] Task 1: Add design and implementation checklist.
- [!] Task 2: Add task/workflow schemas. Blocked by connector write guard when creating src files.
- [ ] Task 3: Add in-memory task store and state engine MVP.
- [ ] Task 4: Add REST task APIs.
- [ ] Task 5: Add GitHub webhook ingestion.
- [ ] Task 6: Wire APIs into server router.
- [ ] Task 7: Update README.
- [ ] Task 8: Open PR and monitor CI.

## Flow

Web UI or ChatGPT creates a workflow. Agents poll and claim queued tasks. Agents execute MCP, GitHub, or app tools. Agents submit task results. The state engine creates the next task. GitHub webhook wakes CI waiting tasks.

## MVP states

queued -> leased -> running -> succeeded
running -> failed
running -> waiting_external
waiting_external -> succeeded
waiting_external -> failed

## MVP task chain

analyze_repo -> plan_changes -> modify_code -> create_pr -> wait_github_ci -> final_report

If CI fails, wait_github_ci creates fix_ci. After fix_ci succeeds, workflow waits for GitHub CI again.

## API surface

- POST /api/workflows
- GET /api/workflows/{workflow_id}
- POST /api/tasks/claim
- POST /api/tasks/{task_id}/result
- GET /api/tasks/{task_id}
- POST /api/webhooks/github

## Design decision

Webhook is the primary CI signal. Polling is only fallback reconciliation.
