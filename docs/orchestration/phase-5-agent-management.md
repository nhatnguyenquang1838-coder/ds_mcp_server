# Phase 5 - Agent Management

## Objective

Introduce durable agent registration and runtime health so the scheduler can dispatch work to the best available agent.

## Agent data

Recommended future tables:

- `agents`
- `agent_capabilities`
- `agent_heartbeats`
- `agent_queue_stats`

## Required fields

### agents

- `id text primary key`
- `name text not null`
- `status text not null`
- `version text`
- `metadata_json jsonb not null default '{}'::jsonb`
- `registered_at timestamptz not null default now()`
- `last_seen_at timestamptz`

### agent_capabilities

- `agent_id text references agents(id)`
- `capability text not null`
- `priority int not null default 100`

### agent_heartbeats

- `id uuid primary key`
- `agent_id text references agents(id)`
- `status text not null`
- `current_task_id uuid`
- `current_lease_id uuid`
- `queue_depth int`
- `payload_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

## Runtime behavior

Agents should:

1. Register identity and capabilities.
2. Send periodic heartbeat.
3. Claim only compatible tasks.
4. Include current lease/task in heartbeat.
5. Mark themselves unavailable during shutdown or maintenance.

## Dispatch inputs

The scheduler can rank agents by:

- capability match
- heartbeat freshness
- current lease count
- queue depth
- last failure count
- task priority

## Acceptance criteria

- Agent identity is durable.
- Capabilities are queryable.
- Heartbeat freshness is visible.
- The system can detect stale agents.
- Task claim can filter by required capability.
- Dashboard can show running agents and current lease ownership.
