import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { isSupabaseConfigured } from "./db/supabaseClient.js";
import {
  appendTaskEvent as appendPersistentTaskEvent,
  claimNextTaskRecord,
  createTaskRecord,
  createWorkflowRecord,
  findWaitingGithubTasks,
  getWorkflowRecord,
  markWebhookDeliveryProcessed,
  recordWebhookDelivery,
  updateTaskResultRecord,
  updateWorkflowStatus
} from "./repositories/orchestrationRepository.js";

export type AsyncWorkflowStatus = "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type AsyncTaskStatus = "queued" | "leased" | "running" | "waiting_external" | "succeeded" | "failed" | "cancelled" | "dead_letter";
export type AsyncTaskType = "analyze_repo" | "plan_changes" | "modify_code" | "create_pr" | "wait_github_ci" | "fix_ci" | "final_report";

export type AsyncWorkflow = {
  id: string;
  name: string;
  source: "web" | "chatgpt" | "system";
  status: AsyncWorkflowStatus;
  current_task_id?: string;
  context_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AsyncTask = {
  id: string;
  workflow_id: string;
  parent_task_id?: string;
  type: AsyncTaskType;
  status: AsyncTaskStatus;
  payload_json: Record<string, unknown>;
  result_json?: Record<string, unknown>;
  error_json?: Record<string, unknown>;
  lease_owner?: string;
  lease_expires_at?: string;
  wait_key?: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
};

export type AsyncTaskEvent = {
  id: string;
  workflow_id: string;
  task_id?: string;
  event_type: string;
  actor: "web" | "chatgpt" | "agent" | "state_engine" | "github" | "system";
  data_json: Record<string, unknown>;
  created_at: string;
};

const workflows = new Map<string, AsyncWorkflow>();
const tasks = new Map<string, AsyncTask>();
const events: AsyncTaskEvent[] = [];
const processedDeliveries = new Set<string>();

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function appendMemoryEvent(event: Omit<AsyncTaskEvent, "id" | "created_at">): AsyncTaskEvent {
  const record = { id: createId("aevt"), created_at: now(), ...event };
  events.push(record);
  return record;
}

function setMemoryWorkflowCurrentTask(workflowId: string, taskId: string | undefined): void {
  const workflow = workflows.get(workflowId);
  if (!workflow) return;
  workflow.current_task_id = taskId;
  workflow.updated_at = now();
  workflows.set(workflowId, workflow);
}

function createMemoryTask(input: {
  workflow_id: string;
  parent_task_id?: string;
  type: AsyncTaskType;
  status?: AsyncTaskStatus;
  payload_json?: Record<string, unknown>;
  wait_key?: string;
}): AsyncTask {
  const timestamp = now();
  const task: AsyncTask = {
    id: createId("atask"),
    workflow_id: input.workflow_id,
    parent_task_id: input.parent_task_id,
    type: input.type,
    status: input.status ?? "queued",
    payload_json: input.payload_json ?? {},
    wait_key: input.wait_key,
    retry_count: 0,
    max_retries: 3,
    created_at: timestamp,
    updated_at: timestamp
  };
  tasks.set(task.id, task);
  setMemoryWorkflowCurrentTask(task.workflow_id, task.id);
  appendMemoryEvent({
    workflow_id: task.workflow_id,
    task_id: task.id,
    event_type: "task_created",
    actor: "state_engine",
    data_json: { type: task.type, status: task.status }
  });
  return task;
}

function nextTaskType(task: AsyncTask, result: Record<string, unknown>): AsyncTaskType | undefined {
  if (task.status === "failed") return undefined;
  if (task.type === "analyze_repo") return "plan_changes";
  if (task.type === "plan_changes") return "modify_code";
  if (task.type === "modify_code") return "create_pr";
  if (task.type === "create_pr") return "wait_github_ci";
  if (task.type === "wait_github_ci") return result.conclusion === "failure" ? "fix_ci" : "final_report";
  if (task.type === "fix_ci") return "wait_github_ci";
  return undefined;
}

export async function createAsyncWorkflow(config: AppConfig, input: {
  name: string;
  source?: "web" | "chatgpt" | "system";
  input?: Record<string, unknown>;
  first_task_type?: AsyncTaskType;
}): Promise<{ workflow: AsyncWorkflow; task: AsyncTask }> {
  const source = input.source ?? "web";
  const context = input.input ?? {};

  if (isSupabaseConfigured(config)) {
    const workflow = await createWorkflowRecord(config, {
      name: input.name,
      source,
      context_json: context
    });
    const task = await createTaskRecord(config, {
      workflow_id: workflow.id,
      type: input.first_task_type ?? "analyze_repo",
      payload_json: context
    });
    return { workflow: { ...workflow, current_task_id: task.id }, task };
  }

  const timestamp = now();
  const workflow: AsyncWorkflow = {
    id: createId("awf"),
    name: input.name,
    source,
    status: "running",
    context_json: context,
    created_at: timestamp,
    updated_at: timestamp
  };
  workflows.set(workflow.id, workflow);
  appendMemoryEvent({ workflow_id: workflow.id, event_type: "workflow_created", actor: workflow.source, data_json: workflow.context_json });
  const task = createMemoryTask({ workflow_id: workflow.id, type: input.first_task_type ?? "analyze_repo", payload_json: workflow.context_json });
  return { workflow: workflows.get(workflow.id) ?? workflow, task };
}

export async function getAsyncWorkflow(config: AppConfig, id: string): Promise<{ workflow: AsyncWorkflow; tasks: AsyncTask[]; events: AsyncTaskEvent[] } | undefined> {
  if (isSupabaseConfigured(config)) {
    return getWorkflowRecord(config, id);
  }

  const workflow = workflows.get(id);
  if (!workflow) return undefined;
  return {
    workflow,
    tasks: [...tasks.values()].filter((task) => task.workflow_id === id),
    events: events.filter((event) => event.workflow_id === id)
  };
}

export async function claimAsyncTask(config: AppConfig, input: { agent_id: string; capabilities: AsyncTaskType[]; lease_seconds?: number }): Promise<AsyncTask | undefined> {
  if (isSupabaseConfigured(config)) {
    return claimNextTaskRecord(config, input);
  }

  const nowMs = Date.now();
  const task = [...tasks.values()].find((candidate) => {
    if (!input.capabilities.includes(candidate.type)) return false;
    if (candidate.status === "queued") return true;
    if (candidate.status !== "leased") return false;
    return candidate.lease_expires_at ? Date.parse(candidate.lease_expires_at) <= nowMs : false;
  });
  if (!task) return undefined;
  task.status = "leased";
  task.lease_owner = input.agent_id;
  task.lease_expires_at = new Date(nowMs + (input.lease_seconds ?? 120) * 1000).toISOString();
  task.updated_at = now();
  tasks.set(task.id, task);
  appendMemoryEvent({ workflow_id: task.workflow_id, task_id: task.id, event_type: "task_claimed", actor: "agent", data_json: { agent_id: input.agent_id } });
  return task;
}

export async function submitAsyncTaskResult(
  config: AppConfig,
  taskId: string,
  input: { status: "succeeded" | "failed"; summary?: string; artifacts?: Record<string, unknown>; error?: Record<string, unknown> }
): Promise<{ task: AsyncTask; next_task?: AsyncTask } | undefined> {
  if (isSupabaseConfigured(config)) {
    const task = await updateTaskResultRecord(config, taskId, input);
    if (!task) return undefined;

    if (input.status === "failed") {
      await updateWorkflowStatus(config, task.workflow_id, "failed", task.id);
      return { task };
    }

    if (task.type === "final_report") {
      await updateWorkflowStatus(config, task.workflow_id, "succeeded", undefined);
      await appendPersistentTaskEvent(config, {
        workflow_id: task.workflow_id,
        task_id: task.id,
        event_type: "workflow_succeeded",
        actor: "state_engine",
        data_json: {}
      });
      return { task };
    }

    const next = nextTaskType(task, task.result_json ?? {});
    if (!next) return { task };

    const nextTask = await createTaskRecord(config, {
      workflow_id: task.workflow_id,
      parent_task_id: task.id,
      type: next,
      status: next === "wait_github_ci" ? "waiting_external" : "queued",
      payload_json: task.result_json ?? {},
      wait_key: String(task.result_json?.head_sha ?? task.result_json?.pr_number ?? "") || undefined
    });

    if (next === "wait_github_ci") {
      await updateWorkflowStatus(config, task.workflow_id, "waiting", nextTask.id);
    }

    return { task, next_task: nextTask };
  }

  const task = tasks.get(taskId);
  if (!task) return undefined;
  task.status = input.status;
  task.result_json = { summary: input.summary, ...(input.artifacts ?? {}) };
  task.error_json = input.error;
  task.updated_at = now();
  tasks.set(task.id, task);
  appendMemoryEvent({ workflow_id: task.workflow_id, task_id: task.id, event_type: "task_result_submitted", actor: "agent", data_json: input });

  if (input.status === "failed") {
    const workflow = workflows.get(task.workflow_id);
    if (workflow) {
      workflow.status = "failed";
      workflow.updated_at = now();
      workflows.set(workflow.id, workflow);
    }
    return { task };
  }

  if (task.type === "final_report") {
    const workflow = workflows.get(task.workflow_id);
    if (workflow) {
      workflow.status = "succeeded";
      workflow.current_task_id = undefined;
      workflow.updated_at = now();
      workflows.set(workflow.id, workflow);
      appendMemoryEvent({ workflow_id: workflow.id, task_id: task.id, event_type: "workflow_succeeded", actor: "state_engine", data_json: {} });
    }
    return { task };
  }

  const next = nextTaskType(task, task.result_json ?? {});
  if (!next) return { task };
  const nextTask = createMemoryTask({ workflow_id: task.workflow_id, parent_task_id: task.id, type: next, status: next === "wait_github_ci" ? "waiting_external" : "queued", payload_json: task.result_json ?? {}, wait_key: String(task.result_json?.head_sha ?? task.result_json?.pr_number ?? "") || undefined });
  if (next === "wait_github_ci") {
    const workflow = workflows.get(task.workflow_id);
    if (workflow) {
      workflow.status = "waiting";
      workflow.updated_at = now();
      workflows.set(workflow.id, workflow);
    }
  }
  return { task, next_task: nextTask };
}

export async function handleGithubCiEvent(
  config: AppConfig,
  input: { delivery_id: string; repo?: string; pr_number?: number; head_sha?: string; conclusion?: string }
): Promise<{ matched: number; ignored_duplicate: boolean }> {
  if (isSupabaseConfigured(config)) {
    const delivery = await recordWebhookDelivery(config, {
      provider: "github",
      delivery_id: input.delivery_id,
      event_type: "ci_status",
      payload_json: input
    });
    if (delivery.ignored_duplicate) return { matched: 0, ignored_duplicate: true };

    const waitingTasks = await findWaitingGithubTasks(config, input);
    for (const task of waitingTasks) {
      await submitAsyncTaskResult(config, task.id, {
        status: input.conclusion === "failure" ? "failed" : "succeeded",
        artifacts: { conclusion: input.conclusion ?? "success", delivery_id: input.delivery_id }
      });
    }

    await markWebhookDeliveryProcessed(config, "github", input.delivery_id);
    return { matched: waitingTasks.length, ignored_duplicate: false };
  }

  if (processedDeliveries.has(input.delivery_id)) return { matched: 0, ignored_duplicate: true };
  processedDeliveries.add(input.delivery_id);
  let matched = 0;
  for (const task of tasks.values()) {
    if (task.type !== "wait_github_ci" || task.status !== "waiting_external") continue;
    const waitKey = task.wait_key ?? "";
    const match = Boolean((input.head_sha && waitKey.includes(input.head_sha)) || (input.pr_number && waitKey.includes(String(input.pr_number))));
    if (!match) continue;
    matched += 1;
    await submitAsyncTaskResult(config, task.id, { status: input.conclusion === "failure" ? "failed" : "succeeded", artifacts: { conclusion: input.conclusion ?? "success", delivery_id: input.delivery_id } });
  }
  return { matched, ignored_duplicate: false };
}
