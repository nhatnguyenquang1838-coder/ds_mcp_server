# Local-first Dashboard Cache

## Objective

Reduce visible dashboard latency without replacing Supabase as the durable source of truth for orchestration state.

## Design

The dashboard uses a two-layer cache:

```text
Browser IndexedDB cache
  -> render last known snapshot immediately
  -> API refresh in background
  -> Supabase remains durable source-of-truth
```

A short server-side TTL cache also protects repeated dashboard API calls from triggering the full Supabase query fan-out every interaction.

## Browser embedded DB

The static dashboard page is available at:

```text
/dashboard/orchestration.html
```

It uses browser `IndexedDB` with a `localStorage` fallback for:

- latest orchestration snapshot
- latest dashboard summary
- rendered dashboard state

Bearer tokens are stored in `sessionStorage` only. They are not persisted to IndexedDB or localStorage.

## Server TTL cache

`getOrchestrationDashboardSnapshot()` keeps a short process-local TTL cache keyed by dashboard limit.

Default TTL:

```text
1500ms
```

Override:

```env
DASHBOARD_CACHE_TTL_MS=1500
```

Set `DASHBOARD_CACHE_TTL_MS=0` to disable the server cache.

## Source-of-truth rule

The cache is not authoritative.

The following tables remain Supabase-backed production state:

- `workflows`
- `tasks`
- `task_events`
- `task_leases`
- `task_locks`
- `webhook_deliveries`
- `dead_letter_tasks`
- `agents`
- `agent_heartbeats`
- `scheduler_runs`
- `cron_schedules`
- `retry_policies`

## UX behavior

On dashboard load:

1. Open browser embedded DB.
2. Render cached snapshot immediately if present.
3. Fetch `/api/dashboard/summary`.
4. Fetch `/api/dashboard/orchestration?limit=50`.
5. Store fresh responses in browser DB.
6. Auto-refresh every 15 seconds.

## Safety constraints

- Do not write secrets to IndexedDB or localStorage.
- Do not treat browser DB as orchestration source-of-truth.
- Do not move task queue, leases, locks, retry, or scheduler state into browser-only storage.
- Keep Supabase as the durable shared backend while using local DB for UI responsiveness.
