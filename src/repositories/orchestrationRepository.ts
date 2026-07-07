import type { AppConfig } from "../config.js";
import { getSupabaseClient } from "../db/supabaseClient.js";
import type {
  AsyncTask,
  AsyncTaskEvent,
  AsyncTaskStatus,
  AsyncTaskType,
  AsyncWorkflow,
  AsyncWorkflowStatus
} from "../asyncWorkflowStore.js";

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

type JsonRecord = Record<string, unknown>;

type WorkflowRow = AsyncWorkflow & {
  workflow_type?: string;
  current_state?: string;
  input_json?: JsonRecord;
  output_json?: JsonRecord | null;
  metadata_json?: JsonRecord;
};

type TaskRow = AsyncTask & {
  priority?: number;
  run_after?: string;
  attempts?: number;
  max_attempts?: number;
  completed_at?: string | null;
};

type TaskEventRow = AsyncTaskEvent & {
  actor_type?: string | null;
  actor_id?: string | null;
  payload_json?: JsonRecord;
};

function asWorkflow(row: WorkflowRow): AsyncWorkflow {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    status: row.status,
    current_task_id: row.current_task_id ?? undefined,
    context_json: row.context_json ?? row.input_json ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function asTask(row: TaskRow): AsyncTask {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    parent_task_id: row.parent_task_id ?? undefined,
    type: row.type,
    status: row.status,
    payload_json: row.payload_json ?? {},
    result_json: row.result_json ?? undefined,
    error_json: row.error_json ?? undefined,
    lease_owner: row.lease_owner ?? undefined,
    lease_expires_at: row.lease_expires_at ?? undefined,
    wait_key: row.wait_key ?? undefined,
    retry_count: row.retry_count ?? row.attempts ?? 0,
    max_retries: row.max_retries ?? row.max_attempts ?? 3,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function asTaskEvent(row: TaskEventRow): AsyncTaskEvent {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    task_id: row.task_id ?? undefined,
    event_type: row.event_type,
    actor: row.actor,
    data_json: row.data_json ?? row.payload_json ?? {},
    created_at: row.created_at
  };
}

export async function appendTaskEvent(
  config: AppConfig,
  event: Omit<AsyncTaskEvent, "id" | "created_at">
): Promise<AsyncTaskEvent> {
  const supabase = getSupabaseClient(config);
  const record = {
    id: createId("aevt"),
    workflow_id: event.workflow_id,
    task_id: event.task_id ?? null,
    event_type: event.event_type,
    actor: event.actor,
    actor_type: event.actor,
    data_json: event.data_json,
    payload_json: event.data_json,
    created_at: now()
  };

  const { data, error } = await supabase.from("task_events").insert(record).select("*").single();
  if (error) throw new Error(`Failed to append task event: ${error.message}`);
  return asTaskEvent(data as TaskEventRow);
}

export async function createWorkflowRecord(
  config: AppConfig,
  input: {
    name: string;
    source: "web" | "chatgpt" | "system";
    context_json: JsonRecord;
  }
): Promise<AsyncWorkflow> {
  const supabase = getSupabaseClient(config);
  const timestamp = now();
  const workflow = {
    id: createId("awf"),
    workflow_type: "async_agent_workflow",
    name: input.name,
    source: input.source,
    status: "running" satisfies AsyncWorkflowStatus,
    current_state: "created",
    current_task_id: null,
    context_json: input.context_json,
    input_json: input.context_json,
    metadata_json: {},
    created_at: timestamp,
    updated_at: timestamp
  };

  const { data, error } = await supabase.from("workflows").insert(workflow).select("*").single();
  if (error) throw new Error(`Failed to create workflow: ${error.message}`);

  await appendTaskEvent(config, {
    workflow_id: workflow.id,
    event_type: "workflow_created",
    actor: input.source,
    data_json: input.context_json
  });

  return asWorkflow(data as WorkflowRow);
}

export async function updateWorkflowCurrentTask(
  config: AppConfig,
  workflowId: string,
  taskId: string | undefined
): Promise<void> {
  const supabase = getSupabaseClient(config);
  const { error } = await supabase
    .from("workflows")
    .update({ current_task_id: taskId ?? null, updated_at: now() })
    .eq("id", workflowId);
  if (error) throw new Error(`Failed to update workflow current task: ${error.message}`);
}

export async function updateWorkflowStatus(
  config: AppConfig,
  workflowId: string,
  status: AsyncWorkflowStatus,
  currentTaskId?: string
): Promise<void> {
  const supabase = getSupabaseClient(config);
  const { error } = await supabase
    .from("workflows")
    .update({
      status,
      current_state: status,
      current_task_id: currentTaskId ?? null,
      updated_at: now()
    })
    .eq("id", workflowId);
  if (error) throw new Error(`Failed to update workflow status: ${error.message}`);
}

export async function createTaskRecord(
  config: AppConfig,
  input: {
    workflow_id: string;
    parent_task_id?: string;
    type: AsyncTaskType;
    status?: AsyncTaskStatus;
    payload_json?: JsonRecord;
    wait_key?: string;
  }
): Promise<AsyncTask> {
  const supabase = getSupabaseClient(config);
  const timestamp = now();
  const task = {
    id: createId("atask"),
    workflow_id: input.workflow_id,
    parent_task_id: input.parent_task_id ?? null,
    type: input.type,
    status: input.status ?? "queued",
    priority: 100,
    payload_json: input.payload_json ?? {},
    result_json: null,
    error_json: null,
    wait_key: input.wait_key ?? null,
    retry_count: 0,
    attempts: 0,
    max_retries: 3,
    max_attempts: 3,
    run_after: timestamp,
    created_at: timestamp,
    updated_at: timestamp
  };

  const { data, error } = await supabase.from("tasks").insert(task).select("*").single();
  if (error) throw new Error(`Failed to create task: ${error.message}`);

  await updateWorkflowCurrentTask(config, task.workflow_id, task.id);
  await appendTaskEvent(config, {
    workflow_id: task.workflow_id,
    task_id: task.id,
    event_type: "task_created",
    actor: "state_engine",
    data_json: { type: task.type, status: task.status }
  });

  return asTask(data as TaskRow);
}

export async function getWorkflowRecord(
  config: AppConfig,
  workflowId: string
): Promise<{ workflow: AsyncWorkflow; tasks: AsyncTask[]; events: AsyncTaskEvent[] } | undefined> {
  const supabase = getSupabaseClient(config);
  const { data: workflow, error: workflowError } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .maybeSingle();

  if (workflowError) throw new Error(`Failed to get workflow: ${workflowError.message}`);
  if (!workflow) return undefined;

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: true });
  if (tasksError) throw new Error(`Failed to get workflow tasks: ${tasksError.message}`);

  const { data: events, error: eventsError } = await supabase
    .from("task_events")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: true });
  if (eventsError) throw new Error(`Failed to get workflow events: ${eventsError.message}`);

  return {
    workflow: asWorkflow(workflow as WorkflowRow),
    tasks: ((tasks ?? []) as TaskRow[]).map(asTask),
    events: ((events ?? []) as TaskEventRow[]).map(asTaskEvent)
  };
}

export async function claimNextTaskRecord(
  config: AppConfig,
  input: { agent_id: string; capabilities: AsyncTaskType[]; lease_seconds?: number }
): Promise<AsyncTask | undefined> {
  const supabase = getSupabaseClient(config);
  const nowIso = now();
  const leaseToken = createId("lease");
  const leaseExpiresAt = new Date(Date.now() + (input.lease_seconds ?? 120) * 1000).toISOString();

  const { data: candidates, error: selectError } = await supabase
    .from("tasks")
    .select("*")
    .in("type", input.capabilities)
    .in("status", ["queued", "leased"])
    .lte("run_after", nowIso)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(20);

  if (selectError) throw new Error(`Failed to select claimable tasks: ${selectError.message}`);

  for (const candidate of (candidates ?? []) as TaskRow[]) {
    if (candidate.status === "leased" && candidate.lease_expires_at && Date.parse(candidate.lease_expires_at) > Date.now()) {
      continue;
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "leased" satisfies AsyncTaskStatus,
        lease_owner: input.agent_id,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        updated_at: now()
      })
      .eq("id", candidate.id)
      .or(`status.eq.queued,and(status.eq.leased,lease_expires_at.lte.${nowIso})`)
      .select("*");

    if (updateError) throw new Error(`Failed to claim task: ${updateError.message}`);
    const updated = (updatedRows ?? [])[0] as TaskRow | undefined;
    if (!updated) continue;

    const { error: leaseError } = await supabase.from("task_leases").insert({
      id: createId("tleas"),
      task_id: updated.id,
      agent_id: input.agent_id,
      lease_token: leaseToken,
      status: "active",
      leased_at: now(),
      expires_at: leaseExpiresAt
    });
    if (leaseError) throw new Error(`Failed to create task lease: ${leaseError.message}`);

    await appendTaskEvent(config, {
      workflow_id: updated.workflow_id,
      task_id: updated.id,
      event_type: "task_claimed",
      actor: "agent",
      data_json: { agent_id: input.agent_id, lease_token: leaseToken, lease_expires_at: leaseExpiresAt }
    });

    return asTask(updated);
  }

  return undefined;
}

export async function updateTaskResultRecord(
  config: AppConfig,
  taskId: string,
  input: { status: "succeeded" | "failed"; summary?: string; artifacts?: JsonRecord; error?: JsonRecord }
): Promise<AsyncTask | undefined> {
  const supabase = getSupabaseClient(config);
  const resultJson = { summary: input.summary, ...(input.artifacts ?? {}) };
  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: input.status,
      result_json: resultJson,
      error_json: input.error ?? null,
      updated_at: now(),
      completed_at: now()
    })
    .eq("id", taskId)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(`Failed to update task result: ${error.message}`);
  if (!data) return undefined;

  const task = asTask(data as TaskRow);
  await appendTaskEvent(config, {
    workflow_id: task.workflow_id,
    task_id: task.id,
    event_type: "task_result_submitted",
    actor: "agent",
    data_json: input
  });

  if (input.status === "failed") {
    await supabase.from("dead_letter_tasks").insert({
      id: createId("dlt"),
      original_task_id: task.id,
      workflow_id: task.workflow_id,
      type: task.type,
      payload_json: task.payload_json,
      error_json: input.error ?? resultJson,
      failed_at: now()
    });
    await appendTaskEvent(config, {
      workflow_id: task.workflow_id,
      task_id: task.id,
      event_type: "task_moved_to_dead_letter",
      actor: "state_engine",
      data_json: { reason: "task_failed" }
    });
  }

  return task;
}

export async function recordWebhookDelivery(
  config: AppConfig,
  input: { provider: string; delivery_id: string; event_type: string; payload_json: JsonRecord }
): Promise<{ ignored_duplicate: boolean }> {
  const supabase = getSupabaseClient(config);
  const { error } = await supabase.from("webhook_deliveries").insert({
    id: createId("whdel"),
    provider: input.provider,
    delivery_id: input.delivery_id,
    event_type: input.event_type,
    payload_json: input.payload_json,
    status: "received",
    received_at: now()
  });

  if (!error) return { ignored_duplicate: false };
  if (error.code === "23505") return { ignored_duplicate: true };
  throw new Error(`Failed to record webhook delivery: ${error.message}`);
}

export async function markWebhookDeliveryProcessed(
  config: AppConfig,
  provider: string,
  deliveryId: string
): Promise<void> {
  const supabase = getSupabaseClient(config);
  const { error } = await supabase
    .from("webhook_deliveries")
    .update({ status: "processed", processed_at: now() })
    .eq("provider", provider)
    .eq("delivery_id", deliveryId);
  if (error) throw new Error(`Failed to mark webhook processed: ${error.message}`);
}

export async function findWaitingGithubTasks(
  config: AppConfig,
  input: { pr_number?: number; head_sha?: string }
): Promise<AsyncTask[]> {
  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("type", "wait_github_ci")
    .eq("status", "waiting_external");

  if (error) throw new Error(`Failed to find waiting GitHub tasks: ${error.message}`);

  return ((data ?? []) as TaskRow[])
    .map(asTask)
    .filter((task) => {
      const waitKey = task.wait_key ?? "";
      return Boolean(
        (input.head_sha && waitKey.includes(input.head_sha)) ||
          (input.pr_number && waitKey.includes(String(input.pr_number)))
      );
    });
}
