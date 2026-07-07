# Phase 3 - State Engine

## Objective

Move workflow transitions out of ad hoc route handlers and into a dedicated State Engine.

Instead of:

```text
submitTaskResult()
  -> if success, create next task
```

Use:

```text
StateEngine
  -> load workflow
  -> evaluate rules
  -> update workflow state
  -> create next task
  -> emit events
```

## Scope

In scope:

- Central transition function for workflow/task results
- Rule evaluation per workflow type
- Event emission for every transition
- Idempotent transition handling
- Explicit waiting, running, completed, failed, and blocked states

Out of scope:

- Visual workflow builder
- Full DSL editor
- Human approval UI
- Memory ranking

## Proposed modules

- `src/state/stateEngine.ts`
- `src/state/workflowDefinitions.ts`
- `src/state/rules.ts`
- `src/state/transitions.ts`
- `src/state/stateEngineTypes.ts`

## Core concepts

### Workflow definition

A workflow definition declares:

- `workflow_type`
- allowed states
- task types per state
- transition rules
- terminal states
- approval gates
- retry policy references

### Transition input

The State Engine receives:

- workflow id
- task id
- event type
- task result or webhook payload
- actor metadata
- idempotency key

### Transition output

The State Engine returns:

- updated workflow state
- created tasks
- emitted events
- terminal status when applicable

## Required behavior

- The engine must load current workflow state from Supabase.
- The engine must validate that the incoming event is legal for the current state.
- The engine must create the next task only through repository functions.
- The engine must emit `task_events` and workflow events.
- Duplicate events must be ignored or handled idempotently.
- Illegal transitions must fail safely and emit diagnostic events.

## Acceptance criteria

- No route handler directly decides the next workflow task.
- Task result handling calls the State Engine.
- GitHub webhook handling calls the State Engine.
- Each transition is covered by an event record.
- Invalid transitions do not corrupt workflow state.
- State definitions are readable and configurable in code.
- `npm run typecheck` and `npm run build` pass.
