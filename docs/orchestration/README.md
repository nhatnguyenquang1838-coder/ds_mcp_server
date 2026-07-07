# Orchestration Platform Roadmap

This roadmap moves the DS MCP server from an in-memory MCP/REST prototype into a durable multi-agent orchestration platform.

## Baseline

The MVP already covers:

- Async workflow/task engine prototype
- Agent claim/result flow
- GitHub webhook integration
- CI monitoring loop
- Green PR validation path

The remaining risk is durability. In-memory task, run, webhook, and dashboard state is lost on server restart and cannot support horizontal workers safely.

## Phase sequence

| Phase | Name | Primary outcome | Depends on |
|---|---|---|---|
| 2 | Persistence | Supabase-backed workflows, tasks, events, leases, locks, webhook deliveries, and dead letters | MVP |
| 3 | State Engine | Dedicated transition engine that loads workflow state, evaluates rules, creates next tasks, and emits events | Phase 2 |
| 4 | Dashboard | Operational visibility into workflows, queues, agents, webhooks, failures, upstream calls, and event timeline | Phase 2 |
| 5 | Agent Management | Registered agents, capabilities, heartbeat, lease ownership, and dispatch metadata | Phase 2 |
| 6 | Scheduling | Delayed tasks, cron tasks, retries, backoff, timeouts, and lease expiration | Phase 2, Phase 5 |
| 7 | Human Approval | Approval gates before sensitive transitions such as code modification | Phase 3 |
| 8 | Memory | Persist decisions, fixes, CI patterns, and architecture history for later retrieval | Phase 2, Phase 3 |

## Target architecture

```text
Web UI / ChatGPT
        |
        v
 Workflow API
        |
        v
  State Engine
        |
        v
 PostgreSQL (Supabase)
        |
        +-- Task Queue
        +-- Event Store
        +-- Scheduler
        +-- Memory
        |
        v
     Agents (MCP)

GitHub Webhook --------> State Engine
```

## Execution rule

Phase 2 is the next implementation priority. Do not build Dashboard, Scheduling, Agent Management, Human Approval, or Memory before the persistence foundation is merged.

## Documentation index

- [Phase 2 - Persistence](./phase-2-persistence.md)
- [Phase 3 - State Engine](./phase-3-state-engine.md)
- [Phase 4 - Dashboard](./phase-4-dashboard.md)
- [Phase 5 - Agent Management](./phase-5-agent-management.md)
- [Phase 6 - Scheduling](./phase-6-scheduling.md)
- [Phase 7 - Human Approval](./phase-7-human-approval.md)
- [Phase 8 - Memory](./phase-8-memory.md)
