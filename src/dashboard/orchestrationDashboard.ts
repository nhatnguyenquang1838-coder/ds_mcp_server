import type { AppConfig } from "../config.js";
import { getSupabaseClient, isSupabaseConfigured } from "../db/supabaseClient.js";
import { listAgentHealth } from "../agents/agentRegistry.js";
import { listCronSchedules, listRetryPolicies, listSchedulerRuns } from "../scheduler/orchestrationScheduler.js";

export type OrchestrationDashboardSummary = {
  counts: {
    workflows: number;
    queued_tasks: number;
    running_agents: number;
    online_agents: number;
    stale_agents: number;
    waiting: number;
    failed_tasks: number;
    dead_letter_tasks: number;
    webhook_deliveries: number;
    cron_schedules: number;
    retry_policies: number;
    scheduler_runs: number;
    events: number;
  };
  attention: {
    waiting: number;
    failed_tasks: number;
    dead_letter_tasks: number;
    stale_agents: number;
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
  cache?: {
    hit: boolean;
    cached_at?: string;
    ttl_ms: number;
  };
  summary: OrchestrationDashboardSummary;
  workflows: unknown[];
  task_queue: unknown[];
  running_agents: unknown[];
  agent_health: unknown[];
  waiting: unknown[];
  failed_tasks: unknown[];
  dead_letter_tasks: unknown[];
  webhook_deliveries: unknown[];
  cron_schedules: unknown[];
  retry_policies: unknown[];
  scheduler_runs: unknown[];
  events: unknown[];
};

type CachedDashboardSnapshot = {
  cachedAtMs: number;
  value: OrchestrationDashboardSnapshot;
};

const dashboardSnapshotCache = new Map<string, CachedDashboardSnapshot>();

function now(): string {
  return new Date().toISOString();
}

function dashboardCacheTtlMs(): number {
  const raw = Number(process.env.DASHBOARD_CACHE_TTL_MS ?? 1500);
  if (!Number.isFinite(raw) || raw < 0) return 1500;
  return Math.floor(raw);
}

function cacheKey(limit: number): string {
  return `orchestration:${limit}`;
}

function withCacheMetadata(
  snapshot: OrchestrationDashboardSnapshot,
  input: { hit: boolean; cachedAtMs?: number; ttlMs: number }
): OrchestrationDashboardSnapshot {
  return {
    ...snapshot,
    cache: {
      hit: input.hit,
      cached_at: input.cachedAtMs ? new Date(input.cachedAtMs).toISOString() : undefined,
      ttl_ms: input.ttlMs
    }
  };
}

export function clearOrchestrationDashboardCache(): void {
  dashboardSnapshotCache.clear();
}

function fieldString(row: unknown, field: string): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const value = (row as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function fieldValue(row: unknown, field: string): unknown {
  if (!row || typeof row !== "object") return undefined;
  return (row as Record<string, unknown>)[field];
}

function oldestTimestamp(rows: unknown[], field: string): string | undefined {
  return rows
    .map((row) => fieldString(row, field))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b))[0];
}

function countFreshness(rows: unknown[], freshness: string): number {
  return rows.filter((row) => fieldValue(row, "freshness") === freshness).length;
}

function createSummary(input: {
  workflows: unknown[];
  taskQueue: unknown[];
  runningAgents: unknown[];
  agentHealth: unknown[];
  waiting: unknown[];
  failedTasks: unknown[];
  deadLetters: unknown[];
  webhooks: unknown[];
  cronSchedules: unknown[];
  retryPolicies: unknown[];
  schedulerRuns: unknown[];
  events: unknown[];
}): OrchestrationDashboardSummary {
  const staleAgents = countFreshness(input.agentHealth, "stale") + countFreshness(input.agentHealth, "offline");
  const needsAttention = input.waiting.length + input.failedTasks.length + input.deadLetters.length + staleAgents;

  return {
    counts: {
      workflows: input.workflows.length,
      queued_tasks: input.taskQueue.length,
      running_agents: input.runningAgents.length,
      online_agents: countFreshness(input.agentHealth, "online"),
      stale_agents: staleAgents,
      waiting: input.waiting.length,
      failed_tasks: input.failedTasks.length,
      dead_letter_tasks: input.deadLetters.length,
      webhook_deliveries: input.webhooks.length,
      cron_schedules: input.cronSchedules.length,
      retry_policies: input.retryPolicies.length,
      scheduler_runs: input.schedulerRuns.length,
      events: input.events.length
    },
    attention: {
      waiting: input.waiting.length,
      failed_tasks: input.failedTasks.length,
      dead_letter_tasks: input.deadLetters.length,
      stale_agents: staleAgents,
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
    agentHealth: [],
    waiting: [],
    failedTasks: [],
    deadLetters: [],
    webhooks: [],
    cronSchedules: [],
    retryPolicies: [],
    schedulerRuns: [],
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
  const ttlMs = dashboardCacheTtlMs();
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const key = cacheKey(normalizedLimit);

  if (ttlMs > 0) {
    const cached = dashboardSnapshotCache.get(key);
    if (cached && Date.now() - cached.cachedAtMs <= ttlMs) {
      return withCacheMetadata(cached.value, { hit: true, cachedAtMs: cached.cachedAtMs, ttlMs });
    }
  }

  if (!isSupabaseConfigured(config)) {
    const [agentHealth, cronSchedules, retryPolicies, schedulerRuns] = await Promise.all([
      listAgentHealth(config),
      listCronSchedules(config, normalizedLimit),
      listRetryPolicies(config, normalizedLimit),
      listSchedulerRuns(config, normalizedLimit)
    ]);
    const snapshot: OrchestrationDashboardSnapshot = {
      ok: true,
      generated_at: now(),
      supabase_configured: false,
      summary: createSummary({
        workflows: [],
        taskQueue: [],
        runningAgents: [],
        agentHealth,
        waiting: [],
        failedTasks: [],
        deadLetters: [],
        webhooks: [],
        cronSchedules,
        retryPolicies,
        schedulerRuns,
        events: []
      }),
      workflows: [],
      task_queue: [],
      running_agents: [],
      agent_health: agentHealth,
      waiting: [],
      failed_tasks: [],
      dead_letter_tasks: [],
      webhook_deliveries: [],
      cron_schedules: cronSchedules,
      retry_policies: retryPolicies,
      scheduler_runs: schedulerRuns,
      events: []
    };
    return withCacheMetadata(snapshot, { hit: false, ttlMs });
  }

  const supabase = getSupabaseClient(config);
  const [workflows, taskQueue, leases, waiting, failedTasks, deadLetters, webhooks, events] = await Promise.all([
    selectList(config, "workflows", { limit: normalizedLimit, orderColumn: "updated_at" }),
    selectList(config, "tasks", { limit: normalizedLimit, status: "queued", orderColumn: "updated_at" }),
    selectList(config, "task_leases", { limit: normalizedLimit, status: "active", orderColumn: "leased_at" }),
    selectList(config, "tasks", { limit: normalizedLimit, status: "waiting_external", orderColumn: "updated_at" }),
    selectList(config, "tasks", { limit: normalizedLimit, status: "failed", orderColumn: "updated_at" }),
    selectList(config, "dead_letter_tasks", { limit: normalizedLimit, orderColumn: "failed_at" }),
    selectList(config, "webhook_deliveries", { limit: normalizedLimit, orderColumn: "received_at" }),
    selectList(config, "task_events", { limit: normalizedLimit, orderColumn: "created_at" })
  ]);

  const agentIds = [...new Set((leases as Array<{ agent_id?: string }>).map((lease) => lease.agent_id).filter(Boolean))];
  let runningAgents: unknown[] = leases;
  if (agentIds.length > 0) {
    const { data, error } = await supabase.from("agents").select("*").in("id", agentIds);
    if (error) throw new Error(`Failed to load running agents: ${error.message}`);
    runningAgents = data ?? leases;
  }

  const [agentHealth, cronSchedules, retryPolicies, schedulerRuns] = await Promise.all([
    listAgentHealth(config),
    listCronSchedules(config, normalizedLimit),
    listRetryPolicies(config, normalizedLimit),
    listSchedulerRuns(config, normalizedLimit)
  ]);

  const snapshot: OrchestrationDashboardSnapshot = {
    ok: true,
    generated_at: now(),
    supabase_configured: true,
    summary: createSummary({
      workflows,
      taskQueue,
      runningAgents,
      agentHealth,
      waiting,
      failedTasks,
      deadLetters,
      webhooks,
      cronSchedules,
      retryPolicies,
      schedulerRuns,
      events
    }),
    workflows,
    task_queue: taskQueue,
    running_agents: runningAgents,
    agent_health: agentHealth,
    waiting,
    failed_tasks: failedTasks,
    dead_letter_tasks: deadLetters,
    webhook_deliveries: webhooks,
    cron_schedules: cronSchedules,
    retry_policies: retryPolicies,
    scheduler_runs: schedulerRuns,
    events
  };

  if (ttlMs > 0) {
    dashboardSnapshotCache.set(key, { cachedAtMs: Date.now(), value: snapshot });
  }

  return withCacheMetadata(snapshot, { hit: false, ttlMs });
}
