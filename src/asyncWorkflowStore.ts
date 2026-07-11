import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { isSupabaseConfigured } from "./db/supabaseClient.js";
import {
  claimNextTaskRecord,
  createTaskRecord,
  createWorkflowRecord,
  deleteTaskRecords,
  deleteWorkflowRecord,
  findWaitingGithubTasks,
  getWorkflowRecord,
  listWorkflowRecords,
  markWebhookDeliveryProcessed,
  recordWebhookDelivery,
  updateTaskResultRecord,
  updateWorkflowRecord
} from "./repositories/orchestrationRepository.js";
import { claimFilterSnapshot, taskMatchesClaimFilters } from "./agentops/claimTargeting.js";
import { applyTaskResultTransition } from "./state/stateEngine.js";

export type AsyncWorkflowStatus = "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type AsyncTaskStatus = "queued" | "leased" | "running" | "waiting_external" | "succeeded" | "failed" | "cancelled" | "dead_letter";
export type AsyncTaskType = "analyze_repo" | "plan_changes" | "modify_code" | "create_pr" | "wait_github_ci" | "fix_ci" | "final_report";

export type AsyncTaskClaimInput = {
  agent_id: string;
  capabilities: AsyncTaskType[];
  lease_seconds?: number;
  task_id?: string;
  workflow_id?: string;
  repo?: string;
  repo_owner?: string;
  repo_name?: string;
  branch?: string;
  repo_branch?: string;
  pr_number?: number;
};

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

export async function listAsyncWorkflows(config: AppConfig, limit = 100): Promise<AsyncWorkflow[]> {
  if (isSupabaseConfigured(config)) {
    return listWorkflowRecords(config, limit);
  }

  return [...workflows.values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, Math.min(Math.max(limit, 1), 200));
}

export async function updateAsyncWorkflow(
  config: AppConfig,
  workflowId: string,
  input: { name?: string; input?: Record<string, unknown> }
): Promise<AsyncWorkflow | undefined> {
  if (isSupabaseConfigured(config)) {
    return updateWorkflowRecord(config, workflowId, input);
  }

  const workflow = workflows.get(workflowId);
  if (!workflow) return undefined;
  if (input.name !== undefined) workflow.name = input.name;
  if (input.input !== undefined) workflow.context_json = input.input;
  workflow.updated_at = now();
  workflows.set(workflowId, workflow);
  appendMemoryEvent({
    workflow_id: workflowId,
    event_type: "workflow_updated",
    actor: "web",
    data_json: input
  });
  return workflow;
}

export async function deleteAsyncWorkflow(
  config: AppConfig,
  workflowId: string,
  force = false
): Promise<AsyncWorkflow | undefined> {
  if (isSupabaseConfigured(config)) {
    return deleteWorkflowRecord(config, workflowId, force);
  }

  const workflow = workflows.get(workflowId);
  if (!workflow) return undefined;
  const workflowTasks = [...tasks.values()].filter((task) => task.workflow_id === workflowId);
  const activeTask = workflowTasks.find((task) => ["leased", "running"].includes(task.status));
  if (activeTask) throw new Error(`Workflow has active task ${activeTask.id} in ${activeTask.status} state`);
  if (workflowTasks.length > 0 && !force) {
    throw new Error("Workflow has tasks; use force to delete the workflow and removable tasks");
  }

  for (const task of workflowTasks) tasks.delete(task.id);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.workflow_id === workflowId) events.splice(index, 1);
  }
  workflows.delete(workflowId);
  return workflow;
}

export async function addAsyncWorkflowTasks(
  config: AppConfig,
  workflowId: string,
  inputs: Array<{
    type: AsyncTaskType;
    payload_json?: Record<string, unknown>;
    parent_task_id?: string;
    status?: "queued" | "waiting_external";
    wait_key?: string;
  }>
): Promise<AsyncTask[]> {
  const current = await getAsyncWorkflow(config, workflowId);
  if (!current) throw new Error("Workflow not found");
  if (["succeeded", "failed", "cancelled"].includes(current.workflow.status)) {
    throw new Error(`Workflow in ${current.workflow.status} state cannot accept tasks`);
  }

  const existingTaskIds = new Set(current.tasks.map((task) => task.id));
  for (const input of inputs) {
    if (input.parent_task_id && !existingTaskIds.has(input.parent_task_id)) {
      throw new Error(`Parent task ${input.parent_task_id} does not belong to workflow`);
    }
  }

  const created: AsyncTask[] = [];
  for (const input of inputs) {
    const task = isSupabaseConfigured(config)
      ? await createTaskRecord(config, {
          workflow_id: workflowId,
          parent_task_id: input.parent_task_id,
          type: input.type,
          status: input.status,
          payload_json: input.payload_json,
          wait_key: input.wait_key
        })
      : createMemoryTask({
          workflow_id: workflowId,
          parent_task_id: input.parent_task_id,
          type: input.type,
          status: input.status,
          payload_json: input.payload_json,
          wait_key: input.wait_key
        });
    created.push(task);
  }
  return created;
}

export async function removeAsyncWorkflowTasks(
  config: AppConfig,
  workflowId: string,
  taskIds: string[]
): Promise<AsyncTask[]> {
  if (isSupabaseConfigured(config)) {
    return deleteTaskRecords(config, workflowId, taskIds);
  }

  const matched = taskIds.map((taskId) => tasks.get(taskId));
  if (matched.some((task) => !task || task.workflow_id !== workflowId)) {
    throw new Error("One or more workflow tasks were not found");
  }
  const records = matched as AsyncTask[];
  const protectedTask = records.find((task) => !["queued", "waiting_external"].includes(task.status));
  if (protectedTask) {
    throw new Error(`Workflow task ${protectedTask.id} in ${protectedTask.status} state cannot be removed`);
  }

  for (const task of records) tasks.delete(task.id);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.task_id && taskIds.includes(events[index]!.task_id!)) events.splice(index, 1);
  }
  const remaining = [...tasks.values()]
    .filter((task) => task.workflow_id === workflowId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  setMemoryWorkflowCurrentTask(workflowId, remaining[0]?.id);
  return records;
}

export async function claimAsyncTask(config: AppConfig, input: AsyncTaskClaimInput): Promise<AsyncTask | undefined> {
  if (isSupabaseConfigured(config)) {
    return claimNextTaskRecord(config, input);
  }

  const nowMs = Date.now();
  const task = [...tasks.values()].find((candidate) => {
    if (!input.capabilities.includes(candidate.type)) return false;
    if (!taskMatchesClaimFilters(candidate, workflows.get(candidate.workflow_id), input)) return false;
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
  appendMemoryEvent({
    workflow_id: task.workflow_id,
    task_id: task.id,
    event_type: "task_claimed",
    actor: "agent",
    data_json: {
      agent_id: input.agent_id,
      claim_filters: claimFilterSnapshot(input)
    }
  });
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
    return applyTaskResultTransition(config, task, input);
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
