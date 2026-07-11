import type { AppConfig } from "../config.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { availableTaskTransitions, nextTaskState } from "./taskMachine.js";
import type {
  TaskEventRecord,
  TaskLinkRecord,
  TaskRecord,
  TaskState
} from "./types.js";
import type {
  CreateTaskInput,
  CreateTaskLinkInput,
  TransitionTaskInput,
  UpdateTaskInput
} from "./schemas.js";

const TASKS_TABLE = "agentops_tasks";
const LINKS_TABLE = "agentops_task_links";
const EVENTS_TABLE = "agentops_task_events";

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function writeTaskEvent(
  config: AppConfig,
  event: Omit<TaskEventRecord, "id" | "created_at">
): Promise<void> {
  const supabase = getSupabaseClient(config);
  const { error } = await supabase.from(EVENTS_TABLE).insert({
    id: createId("tevt"),
    created_at: now(),
    ...event
  });

  if (error) throw new Error(`Failed to write task event: ${error.message}`);
}

export async function listTasks(config: AppConfig): Promise<TaskRecord[]> {
  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase
    .from(TASKS_TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Failed to list tasks: ${error.message}`);
  return (data ?? []) as TaskRecord[];
}

export async function getTask(config: AppConfig, taskId: string): Promise<TaskRecord | undefined> {
  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase
    .from(TASKS_TABLE)
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get task: ${error.message}`);
  return data as TaskRecord | undefined;
}

export async function createTask(config: AppConfig, input: CreateTaskInput): Promise<TaskRecord> {
  const supabase = getSupabaseClient(config);

  if (input.idempotency_key) {
    const { data: existing, error: existingError } = await supabase
      .from(TASKS_TABLE)
      .select("*")
      .eq("idempotency_key", input.idempotency_key)
      .maybeSingle();
    if (existingError) throw new Error(`Failed to check existing task: ${existingError.message}`);
    if (existing) return existing as TaskRecord;
  }

  const timestamp = now();
  const id = createId("task");
  const record = {
    id,
    title: input.title,
    description: input.description ?? null,
    task_type: input.task_type,
    source: input.source,
    source_ref: input.source_ref ?? null,
    state: "draft" satisfies TaskState,
    priority: input.priority,
    parent_task_id: input.parent_task_id ?? null,
    root_task_id: input.parent_task_id ?? id,
    assigned_agent_id: input.assigned_agent_id ?? null,
    owner_user_id: input.owner_user_id ?? null,
    latest_run_id: null,
    run_count: 0,
    repo_owner: input.repo_owner ?? null,
    repo_name: input.repo_name ?? null,
    repo_branch: input.repo_branch ?? null,
    pr_number: null,
    pr_url: null,
    idempotency_key: input.idempotency_key ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null
  };

  const { data, error } = await supabase.from(TASKS_TABLE).insert(record).select("*").single();
  if (error) throw new Error(`Failed to create task: ${error.message}`);

  await writeTaskEvent(config, {
    task_id: id,
    event_type: "task_created",
    actor: "user",
    idempotency_key: input.idempotency_key,
    payload: { title: input.title }
  });

  return data as TaskRecord;
}

export async function updateTask(
  config: AppConfig,
  taskId: string,
  input: UpdateTaskInput
): Promise<TaskRecord> {
  const supabase = getSupabaseClient(config);
  const updates = {
    ...input,
    updated_at: now()
  };

  const { data, error } = await supabase
    .from(TASKS_TABLE)
    .update(updates)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update task: ${error.message}`);

  await writeTaskEvent(config, {
    task_id: taskId,
    event_type: "task_updated",
    actor: "user",
    idempotency_key: input.idempotency_key,
    payload: input
  });

  return data as TaskRecord;
}

export async function deleteTask(
  config: AppConfig,
  taskId: string,
  force = false
): Promise<TaskRecord> {
  const task = await getTask(config, taskId);
  if (!task) throw new Error("Task not found");

  if (!["draft", "completed", "cancelled"].includes(task.state)) {
    throw new Error(`Task in ${task.state} state cannot be deleted`);
  }

  const supabase = getSupabaseClient(config);
  const links = await listTaskLinks(config, taskId);
  if (links.length > 0 && !force) {
    throw new Error("Task has active links; use force to delete links with the task");
  }

  if (links.length > 0) {
    const { error: linksError } = await supabase
      .from(LINKS_TABLE)
      .delete()
      .or(`from_task_id.eq.${taskId},to_task_id.eq.${taskId}`);
    if (linksError) throw new Error(`Failed to delete task links: ${linksError.message}`);
  }

  const { error: eventsError } = await supabase
    .from(EVENTS_TABLE)
    .delete()
    .eq("task_id", taskId);
  if (eventsError) throw new Error(`Failed to delete task events: ${eventsError.message}`);

  const { error } = await supabase.from(TASKS_TABLE).delete().eq("id", taskId);
  if (error) throw new Error(`Failed to delete task: ${error.message}`);

  return task;
}

export async function listTaskLinks(config: AppConfig, taskId: string): Promise<TaskLinkRecord[]> {
  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase
    .from(LINKS_TABLE)
    .select("*")
    .or(`from_task_id.eq.${taskId},to_task_id.eq.${taskId}`)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list task links: ${error.message}`);
  return (data ?? []) as TaskLinkRecord[];
}

export async function createTaskLink(
  config: AppConfig,
  fromTaskId: string,
  input: CreateTaskLinkInput
): Promise<TaskLinkRecord> {
  if (fromTaskId === input.to_task_id) {
    throw new Error("A task cannot link to itself");
  }

  const [fromTask, toTask] = await Promise.all([
    getTask(config, fromTaskId),
    getTask(config, input.to_task_id)
  ]);
  if (!fromTask || !toTask) throw new Error("Task not found");

  const supabase = getSupabaseClient(config);

  const { data: existing, error: existingError } = await supabase
    .from(LINKS_TABLE)
    .select("*")
    .eq("from_task_id", fromTaskId)
    .eq("to_task_id", input.to_task_id)
    .eq("link_type", input.link_type)
    .eq("status", "active")
    .maybeSingle();
  if (existingError) throw new Error(`Failed to check existing task link: ${existingError.message}`);
  if (existing) return existing as TaskLinkRecord;

  const link = {
    id: createId("tlink"),
    from_task_id: fromTaskId,
    to_task_id: input.to_task_id,
    link_type: input.link_type,
    status: "active",
    created_by: input.created_by ?? null,
    created_at: now()
  };

  const { data, error } = await supabase.from(LINKS_TABLE).insert(link).select("*").single();
  if (error) throw new Error(`Failed to create task link: ${error.message}`);

  await writeTaskEvent(config, {
    task_id: fromTaskId,
    event_type: "link_created",
    actor: "user",
    actor_id: input.created_by,
    idempotency_key: input.idempotency_key,
    payload: link
  });

  return data as TaskLinkRecord;
}

export async function deleteTaskLink(
  config: AppConfig,
  linkId: string
): Promise<TaskLinkRecord> {
  const supabase = getSupabaseClient(config);
  const { data: current, error: currentError } = await supabase
    .from(LINKS_TABLE)
    .select("*")
    .eq("id", linkId)
    .eq("status", "active")
    .maybeSingle();
  if (currentError) throw new Error(`Failed to get task link: ${currentError.message}`);
  if (!current) throw new Error("Task link not found");

  const { data, error } = await supabase
    .from(LINKS_TABLE)
    .update({ status: "inactive" })
    .eq("id", linkId)
    .eq("status", "active")
    .select("*")
    .single();
  if (error) throw new Error(`Failed to delete task link: ${error.message}`);

  const link = data as TaskLinkRecord;
  await writeTaskEvent(config, {
    task_id: link.from_task_id,
    event_type: "link_removed",
    actor: "user",
    payload: { link_id: link.id, to_task_id: link.to_task_id, link_type: link.link_type }
  });
  return link;
}

export async function listTaskEvents(config: AppConfig, taskId: string): Promise<TaskEventRecord[]> {
  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase
    .from(EVENTS_TABLE)
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list task events: ${error.message}`);
  return (data ?? []) as TaskEventRecord[];
}

export async function hasOpenBlockers(config: AppConfig, taskId: string): Promise<boolean> {
  const links = await listTaskLinks(config, taskId);
  const blockerIds = links
    .filter((link) =>
      (link.from_task_id === taskId && link.link_type === "depends_on") ||
      (link.to_task_id === taskId && link.link_type === "blocks")
    )
    .map((link) => (link.from_task_id === taskId ? link.to_task_id : link.from_task_id));

  if (blockerIds.length === 0) return false;

  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase
    .from(TASKS_TABLE)
    .select("id,state")
    .in("id", blockerIds)
    .not("state", "in", "(completed,cancelled)");

  if (error) throw new Error(`Failed to check blockers: ${error.message}`);
  return Boolean(data && data.length > 0);
}

export async function transitionTask(
  config: AppConfig,
  taskId: string,
  input: TransitionTaskInput
): Promise<{ task: TaskRecord; from_state: TaskState; to_state: TaskState; available_transitions: string[]; idempotent_replay?: boolean }> {
  const supabase = getSupabaseClient(config);

  if (input.idempotency_key) {
    const { data: existingEvent, error: existingEventError } = await supabase
      .from(EVENTS_TABLE)
      .select("*")
      .eq("task_id", taskId)
      .eq("idempotency_key", input.idempotency_key)
      .maybeSingle();
    if (existingEventError) throw new Error(`Failed to check existing task event: ${existingEventError.message}`);
    if (existingEvent) {
      const currentTask = await getTask(config, taskId);
      if (!currentTask) throw new Error("Task not found");
      const event = existingEvent as TaskEventRecord;
      return {
        task: currentTask,
        from_state: event.from_state ?? currentTask.state,
        to_state: event.to_state ?? currentTask.state,
        available_transitions: availableTaskTransitions(currentTask.state),
        idempotent_replay: true
      };
    }
  }

  const task = await getTask(config, taskId);
  if (!task) throw new Error("Task not found");

  if (input.transition === "RUN_AGENT" && await hasOpenBlockers(config, taskId)) {
    throw new Error("Task has open blockers");
  }

  const toState = nextTaskState(task.state, input.transition);
  if (!toState) {
    throw new Error(`Invalid transition ${input.transition} from ${task.state}`);
  }

  const updates = {
    state: toState,
    updated_at: now(),
    completed_at: toState === "completed" ? now() : task.completed_at
  };

  const { data, error } = await supabase
    .from(TASKS_TABLE)
    .update(updates)
    .eq("id", taskId)
    .eq("state", task.state)
    .select("*");

  if (error) throw new Error(`Failed to transition task: ${error.message}`);
  const updatedTask = (data ?? [])[0] as TaskRecord | undefined;
  if (!updatedTask) {
    const currentTask = await getTask(config, taskId);
    if (!currentTask) throw new Error("Task not found");
    throw new Error(`Task state changed from ${task.state} to ${currentTask.state}; refresh before retry`);
  }

  await writeTaskEvent(config, {
    task_id: taskId,
    event_type: "state_changed",
    from_state: task.state,
    to_state: toState,
    actor: input.actor,
    actor_id: input.actor_id,
    idempotency_key: input.idempotency_key,
    payload: {
      transition: input.transition,
      note: input.note,
      ...(input.payload ?? {})
    }
  });

  return {
    task: updatedTask,
    from_state: task.state,
    to_state: toState,
    available_transitions: availableTaskTransitions(toState)
  };
}
