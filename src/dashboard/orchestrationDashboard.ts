import type { AppConfig } from "../config.js";
import { getSupabaseClient, isSupabaseConfigured } from "../db/supabaseClient.js";

export type OrchestrationDashboardSummary = {
  counts: {
    workflows: number;
    queued_tasks: number;
    running_agents: number;
    waiting: number;
    failed_tasks: number;
    dead_letter_tasks: number;
    webhook_deliveries: number;
    events: number;
  };
  attention: {
    waiting: number;
    failed_tasks: number;
    dead_letter_tasks: number;
    needs_attention: number;
  };
  oldest: {
    queued_task_updated_at?: string;
    waiting_updated_at?: string;
    failed_task_updated_at?: string;
    dead_letter_failed_at?: string;
  };
};

export type OrchestrationDashboardSnapshot = {
  ok: true;
  generated_at: string;
  supabase_configured: boolean;
  summary: OrchestrationDashboardSummary;
  workflows: unknown[];
  task_queue: unknown[];
  running_agents: unknown[];
  waiting: unknown[];
  failed_tasks: unknown[];
  dead_letter_tasks: unknown[];
  webhook_deliveries: unknown[];
  events: unknown[];
};

function now(): string {
  return new Date().toISOString();
}

function fieldString(row: unknown, field: string): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const value = (row as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function oldestTimestamp(rows: unknown[], field: string): string | undefined {
  return rows
    .map((row) => fieldString(row, field))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b))[0];
}

function createSummary(input: {
  workflows: unknown[];
  taskQueue: unknown[];
  runningAgents: unknown[];
  waiting: unknown[];
  failedTasks: unknown[];
  deadLetters: unknown[];
  webhooks: unknown[];
  events: unknown[];
}): OrchestrationDashboardSummary {
  const needsAttention = input.waiting.length + input.failedTasks.length + input.deadLetters.length;

  return {
    counts: {
      workflows: input.workflows.length,
      queued_tasks: input.taskQueue.length,
      running_agents: input.runningAgents.length,
      waiting: input.waiting.length,
      failed_tasks: input.failedTasks.length,
      dead_letter_tasks: input.deadLetters.length,
      webhook_deliveries: input.webhooks.length,
      events: input.events.length
    },
    attention: {
      waiting: input.waiting.length,
      failed_tasks: input.failedTasks.length,
      dead_letter_tasks: input.deadLetters.length,
      needs_attention: needsAttention
    },
    oldest: {
      queued_task_updated_at: oldestTimestamp(input.taskQueue, "updated_at"),
      waiting_updated_at: oldestTimestamp(input.waiting, "updated_at"),
      failed_task_updated_at: oldestTimestamp(input.failedTasks, "updated_at"),
      dead_letter_failed_at: oldestTimestamp(input.deadLetters, "failed_at")
    }
  };
}

function emptySummary(): OrchestrationDashboardSummary {
  return createSummary({
    workflows: [],
    taskQueue: [],
    runningAgents: [],
    waiting: [],
    failedTasks: [],
    deadLetters: [],
    webhooks: [],
    events: []
  });
}

async function selectList(
  config: AppConfig,
  table: string,
  options: { limit?: number; status?: string; orderColumn?: string } = {}
): Promise<unknown[]> {
  const supabase = getSupabaseClient(config);
  let query = supabase.from(table).select("*");
  if (options.status) query = query.eq("status", options.status);
  query = query.order(options.orderColumn ?? "created_at", { ascending: false }).limit(options.limit ?? 50);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
  return data ?? [];
}

export async function getOrchestrationDashboardSnapshot(
  config: AppConfig,
  limit = 50
): Promise<OrchestrationDashboardSnapshot> {
  if (!isSupabaseConfigured(config)) {
    return {
      ok: true,
      generated_at: now(),
      supabase_configured: false,
      summary: emptySummary(),
      workflows: [],
      task_queue: [],
      running_agents: [],
      waiting: [],
      failed_tasks: [],
      dead_letter_tasks: [],
      webhook_deliveries: [],
      events: []
    };
  }

  const supabase = getSupabaseClient(config);
  const [workflows, taskQueue, leases, waiting, failedTasks, deadLetters, webhooks, events] = await Promise.all([
    selectList(config, "workflows", { limit, orderColumn: "updated_at" }),
    selectList(config, "tasks", { limit, status: "queued", orderColumn: "updated_at" }),
    selectList(config, "task_leases", { limit, status: "active", orderColumn: "leased_at" }),
    selectList(config, "tasks", { limit, status: "waiting_external", orderColumn: "updated_at" }),
    selectList(config, "tasks", { limit, status: "failed", orderColumn: "updated_at" }),
    selectList(config, "dead_letter_tasks", { limit, orderColumn: "failed_at" }),
    selectList(config, "webhook_deliveries", { limit, orderColumn: "received_at" }),
    selectList(config, "task_events", { limit, orderColumn: "created_at" })
  ]);

  const agentIds = [...new Set((leases as Array<{ agent_id?: string }>).map((lease) => lease.agent_id).filter(Boolean))];
  let runningAgents: unknown[] = leases;
  if (agentIds.length > 0) {
    const { data, error } = await supabase.from("agents").select("*").in("id", agentIds);
    if (error) throw new Error(`Failed to load running agents: ${error.message}`);
    runningAgents = data ?? leases;
  }

  return {
    ok: true,
    generated_at: now(),
    supabase_configured: true,
    summary: createSummary({
      workflows,
      taskQueue,
      runningAgents,
      waiting,
      failedTasks,
      deadLetters,
      webhooks,
      events
    }),
    workflows,
    task_queue: taskQueue,
    running_agents: runningAgents,
    waiting,
    failed_tasks: failedTasks,
    dead_letter_tasks: deadLetters,
    webhook_deliveries: webhooks,
    events
  };
}
