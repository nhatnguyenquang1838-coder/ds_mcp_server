# Tasks: Vercel + XState + Supabase

This phase starts the lightweight workflow stack without Temporal.

## Architecture

```text
Vercel ds_mcp_server
  -> REST API /api/tasks
  -> XState task workflow machine
  -> Supabase Postgres persistence
```

## Setup

Run the SQL migration:

```text
supabase/migrations/20260706150000_agentops_tasks.sql
```

Set Vercel env vars:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side-value>
REST_API_BEARER_TOKEN=<optional-admin-token>
```

Keep server-side values out of frontend code and Custom GPT Action schemas.

## Endpoints

```text
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/{task_id}
PATCH  /api/tasks/{task_id}
GET    /api/tasks/{task_id}/links
POST   /api/tasks/{task_id}/links
POST   /api/tasks/{task_id}/transitions
GET    /api/tasks/{task_id}/events
```

## Create task

```bash
curl -X POST https://ds-mcp-server-one.vercel.app/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Review invoice mobile layout","task_type":"design_review","priority":"high","source":"manual"}'
```

## Transition task

Task state is changed through workflow transitions, not direct state patching.

```bash
curl -X POST https://ds-mcp-server-one.vercel.app/api/tasks/task_xxx/transitions \
  -H "Content-Type: application/json" \
  -d '{"transition":"SUBMIT","actor":"user","note":"Ready for review"}'
```

## Default workflow

```text
draft -> ready -> agent_running -> pending_review -> pending_approval -> write_running -> validation_running -> completed
```

Failure and cancel branches:

```text
agent_running -> failed
write_running -> failed
ready -> blocked -> ready
active states -> cancelled
```

## Dependency rule

`RUN_AGENT` is blocked when a task has open blockers from `depends_on` or `blocks` links.

## Next phase

- Add cycle detection for dependency graph.
- Persist workspace-agent runs in Supabase.
- Add `/admin` React UI.
- Add approval queue and write-action gates.
