import { createMachine } from "xstate";
import type { TaskState, TaskTransition } from "./types.js";

export const taskWorkflowMachine = createMachine({
  id: "taskWorkflow",
  initial: "draft",
  states: {
    draft: { on: { SUBMIT: "ready", CANCEL: "cancelled" } },
    ready: { on: { RUN_AGENT: "agent_running", BLOCK: "blocked", CANCEL: "cancelled" } },
    blocked: { on: { UNBLOCK: "ready", CANCEL: "cancelled" } },
    agent_running: {
      on: { CALLBACK_SUCCESS: "pending_review", CALLBACK_FAILED: "failed", CANCEL: "cancelled" }
    },
    pending_review: {
      on: { APPROVE_PLAN: "pending_approval", REVISE: "ready", CANCEL: "cancelled" }
    },
    pending_approval: {
      on: { APPROVE_WRITE: "write_running", REJECT_WRITE: "pending_review", CANCEL: "cancelled" }
    },
    write_running: {
      on: { PR_CREATED: "validation_running", CALLBACK_FAILED: "failed", CANCEL: "cancelled" }
    },
    validation_running: {
      on: { VALIDATION_PASSED: "completed", VALIDATION_FAILED: "pending_review", CANCEL: "cancelled" }
    },
    completed: { type: "final" },
    failed: { on: { REVISE: "ready", CANCEL: "cancelled" } },
    cancelled: { type: "final" }
  }
});

const transitions: Record<TaskState, Partial<Record<TaskTransition, TaskState>>> = {
  draft: { SUBMIT: "ready", CANCEL: "cancelled" },
  ready: { RUN_AGENT: "agent_running", BLOCK: "blocked", CANCEL: "cancelled" },
  blocked: { UNBLOCK: "ready", CANCEL: "cancelled" },
  agent_running: { CALLBACK_SUCCESS: "pending_review", CALLBACK_FAILED: "failed", CANCEL: "cancelled" },
  pending_review: { APPROVE_PLAN: "pending_approval", REVISE: "ready", CANCEL: "cancelled" },
  pending_approval: { APPROVE_WRITE: "write_running", REJECT_WRITE: "pending_review", CANCEL: "cancelled" },
  write_running: { PR_CREATED: "validation_running", CALLBACK_FAILED: "failed", CANCEL: "cancelled" },
  validation_running: { VALIDATION_PASSED: "completed", VALIDATION_FAILED: "pending_review", CANCEL: "cancelled" },
  completed: {},
  failed: { REVISE: "ready", CANCEL: "cancelled" },
  cancelled: {}
};

export function nextTaskState(state: TaskState, transition: TaskTransition): TaskState | undefined {
  return transitions[state]?.[transition];
}

export function availableTaskTransitions(state: TaskState): TaskTransition[] {
  return Object.keys(transitions[state] ?? {}) as TaskTransition[];
}
