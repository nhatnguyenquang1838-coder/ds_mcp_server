# Phase 4 - Dashboard

## Objective

Add operational pages for workflow orchestration visibility.

The dashboard should show what entered the platform, what is running, what is waiting, what failed, and what needs manual intervention.

## Pages

### Workflow Dashboard

Shows workflow instances by status, type, age, current state, and last event.

### Task Queue

Shows queued tasks, priority, `run_after`, attempts, task type, and workflow id.

### Running Agents

Shows active leases, agent id, task id, lease expiration, and last activity.

### Waiting: GitHub/Webhooks

Shows workflows waiting for GitHub checks, webhook callbacks, or external events.

### Failed Tasks

Shows retryable failures, attempt count, last error, and next retry time.

### Dead Letter Queue

Shows terminal failures that need manual review or replay.

### Upstream Calls

Shows inbound calls grouped by upstream/source, method, route, count, and last seen.

### Event Timeline

Shows append-only workflow and task events ordered by time.

## Data source

Dashboard pages must query Supabase tables introduced in Phase 2. Do not use process-local maps for production dashboard data.

## API endpoints

Suggested read-only endpoints:

- `GET /api/dashboard/workflows`
- `GET /api/dashboard/tasks`
- `GET /api/dashboard/agents/running`
- `GET /api/dashboard/waiting`
- `GET /api/dashboard/failed-tasks`
- `GET /api/dashboard/dead-letter-tasks`
- `GET /api/dashboard/upstream-calls`
- `GET /api/dashboard/events`

## UI principles

- Prefer server-rendered simple HTML for MVP if no frontend app exists.
- Keep auto-refresh conservative, for example 10 to 30 seconds.
- Every row should link to source data when possible.
- Failed and dead-letter states must be visible without logs.
- Avoid destructive controls in first dashboard release.

## Acceptance criteria

- Dashboard data survives server restart.
- Operators can see queued, running, waiting, failed, and dead-letter work.
- Upstream activity is visible from durable data.
- Event timeline can reconstruct the lifecycle of one workflow or task.
- No sensitive token or secret is displayed.
