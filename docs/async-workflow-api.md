# Async Workflow API

This API supports Web UI and ChatGPT UI triggers for asynchronous workflow execution.

## Create workflow

```http
POST /api/workflows
```

```json
{
  "name": "add-upstream-dashboard",
  "source": "chatgpt",
  "input": {
    "repo": "nhatnguyenquang1838-coder/rental_home",
    "goal": "Add dashboard showing calls received from upstream systems"
  }
}
```

## Inspect workflow

```http
GET /api/workflows/{workflow_id}
```

Returns the workflow, current tasks, and event timeline.

## Claim task

```http
POST /api/async-tasks/claim
```

```json
{
  "agent_id": "code-agent-01",
  "capabilities": ["analyze_repo", "plan_changes", "modify_code", "create_pr", "fix_ci", "final_report"],
  "lease_seconds": 120
}
```

## Submit task result

```http
POST /api/async-tasks/{task_id}/result
```

```json
{
  "status": "succeeded",
  "summary": "PR created",
  "artifacts": {
    "repo": "nhatnguyenquang1838-coder/ds_mcp_server",
    "pr_number": 14,
    "head_sha": "abc123"
  }
}
```

## GitHub CI event input

```http
POST /api/webhooks/github
```

```json
{
  "delivery_id": "github-delivery-id",
  "repo": "nhatnguyenquang1838-coder/ds_mcp_server",
  "pr_number": 14,
  "head_sha": "abc123",
  "conclusion": "success"
}
```

The endpoint deduplicates by `delivery_id` and wakes matching `wait_github_ci` tasks.

## Persistence note

The MVP store is in-memory. It is intentionally isolated behind `asyncWorkflowStore.ts` so it can later be replaced with Supabase-backed persistence without changing the REST contract.
