import type { IncomingMessage, ServerResponse } from "node:http";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config.js";
import {
  createTaskLinkSchema,
  createTaskSchema,
  transitionTaskSchema,
  updateTaskSchema
} from "./schemas.js";
import {
  createTask,
  createTaskLink,
  getTask,
  listTaskEvents,
  listTaskLinks,
  listTasks,
  transitionTask,
  updateTask
} from "./taskStore.js";
import { availableTaskTransitions } from "./taskMachine.js";
import {
  claimAsyncTaskSchema,
  createAsyncWorkflowSchema,
  githubCiEventSchema,
  submitAsyncTaskResultSchema
} from "../asyncWorkflowSchemas.js";
import {
  claimAsyncTask,
  createAsyncWorkflow,
  getAsyncWorkflow,
  handleGithubCiEvent,
  submitAsyncTaskResult
} from "../asyncWorkflowStore.js";
import { getOrchestrationDashboardSnapshot } from "../dashboard/orchestrationDashboard.js";
import { listAgentHealth, listAgents, recordAgentHeartbeat, registerAgent } from "../agents/agentRegistry.js";
import {
  listCronSchedules,
  listRetryPolicies,
  listSchedulerRuns,
  runSchedulerTick,
  upsertCronSchedule,
  upsertRetryPolicy
} from "../scheduler/orchestrationScheduler.js";
import { getEnvironmentStatus, switchRuntimeEnvironment } from "../devtools/environment.js";
import {
  normalizeGithubCiWebhook,
  parseGithubWebhookBody,
  verifyGithubWebhookSignature
} from "./githubWebhook.js";
import { PayloadTooLargeError } from "../security/requestLimits.js";

export type AgentOpsRouterDeps = {
  config: AppConfig;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  setCorsHeaders: (res: ServerResponse) => void;
  readJsonBody: (req: IncomingMessage) => Promise<unknown>;
  readRawBody: (req: IncomingMessage) => Promise<Buffer>;
};

const registerAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  metadata_json: z.record(z.unknown()).default({})
});

const heartbeatSchema = z.object({
  status: z.string().min(1).default("available"),
  current_task_id: z.string().optional(),
  current_lease_id: z.string().optional(),
  queue_depth: z.number().int().nonnegative().optional(),
  remaining_credits: z.number().nonnegative().optional(),
  payload_json: z.record(z.unknown()).default({})
});

const schedulerTickSchema = z.object({
  scheduler_id: z.string().min(1).default("default")
});

const cronScheduleSchema = z.object({
  id: z.string().min(1).optional(),
  workflow_type: z.string().min(1),
  cron_expression: z.string().min(1),
  timezone: z.string().min(1).default("UTC"),
  payload_json: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
  next_run_at: z.string().min(1).optional()
});

const retryPolicySchema = z.object({
  id: z.string().min(1).optional(),
  task_type: z.string().min(1),
  max_attempts: z.number().int().positive().max(20).default(3),
  base_delay_seconds: z.number().int().nonnegative().max(86_400).default(30),
  max_delay_seconds: z.number().int().positive().max(604_800).default(3600),
  backoff_multiplier: z.number().positive().max(10).default(2)
});

const environmentSwitchSchema = z.object({
  runtime_mode: z.enum(["local", "development", "staging", "production"]).optional(),
  db_target: z.string().min(1).optional()
}).refine((input) => Boolean(input.runtime_mode || input.db_target), {
  message: "runtime_mode or db_target is required"
});

function decodePathValue(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}

function queryLimit(url: URL, fallback = 50): number {
  const limit = Number(url.searchParams.get("limit") || fallback);
  return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : fallback;
}

function queryPositiveInt(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name) || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function apiErrorStatus(error: Error): number {
  if (error.message.includes("not configured")) return 500;
  if (error.message.includes("not found") || error.message.includes("not found")) return 404;
  if (error.message.includes("Invalid transition") || error.message.includes("open blockers")) return 409;
  return 400;
}

function isAgentOpsPath(pathname: string): boolean {
  return pathname.startsWith("/api/tasks") ||
    pathname.startsWith("/api/workflows") ||
    pathname.startsWith("/api/async-tasks") ||
    pathname.startsWith("/api/dashboard") ||
    pathname.startsWith("/api/agents") ||
    pathname.startsWith("/api/scheduler") ||
    pathname.startsWith("/api/dev") ||
    pathname === "/api/webhooks/github";
}

function dashboardSection(snapshot: Awaited<ReturnType<typeof getOrchestrationDashboardSnapshot>>, pathname: string): unknown {
  if (pathname === "/api/dashboard/orchestration") return snapshot;
  if (pathname === "/api/dashboard/summary") {
    return {
      ok: true,
      generated_at: snapshot.generated_at,
      supabase_configured: snapshot.supabase_configured,
      summary: snapshot.summary
    };
  }
  if (pathname === "/api/dashboard/workflows") return { ok: true, workflows: snapshot.workflows };
  if (pathname === "/api/dashboard/tasks") return { ok: true, tasks: snapshot.task_queue };
  if (pathname === "/api/dashboard/agents/running") return { ok: true, agents: snapshot.running_agents };
  if (pathname === "/api/dashboard/agents/health") return { ok: true, agents: snapshot.agent_health };
  if (pathname === "/api/dashboard/waiting") return { ok: true, waiting: snapshot.waiting };
  if (pathname === "/api/dashboard/failed-tasks") return { ok: true, failed_tasks: snapshot.failed_tasks };
  if (pathname === "/api/dashboard/dead-letter-tasks") return { ok: true, dead_letter_tasks: snapshot.dead_letter_tasks };
  if (pathname === "/api/dashboard/upstream-calls") return { ok: true, webhook_deliveries: snapshot.webhook_deliveries };
  if (pathname === "/api/dashboard/cron-schedules") return { ok: true, cron_schedules: snapshot.cron_schedules };
  if (pathname === "/api/dashboard/retry-policies") return { ok: true, retry_policies: snapshot.retry_policies };
  if (pathname === "/api/dashboard/scheduler-runs") return { ok: true, scheduler_runs: snapshot.scheduler_runs };
  if (pathname === "/api/dashboard/events") return { ok: true, events: snapshot.events };
  return undefined;
}

export async function handleAgentOpsRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AgentOpsRouterDeps
): Promise<boolean> {
  const { config, sendJson, setCorsHeaders, readJsonBody, readRawBody } = deps;

  if (!isAgentOpsPath(url.pathname)) return false;

  setCorsHeaders(res);

  try {
    if (req.method === "GET" && url.pathname === "/api/dev/environment") {
      sendJson(res, 200, getEnvironmentStatus(config));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/environment") {
      const body = environmentSwitchSchema.parse(await readJsonBody(req));
      sendJson(res, 200, switchRuntimeEnvironment(config, body));
      return true;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/dashboard/")) {
      const snapshot = await getOrchestrationDashboardSnapshot(config, queryLimit(url));
      const section = dashboardSection(snapshot, url.pathname);
      if (!section) {
        sendJson(res, 404, { error: "Dashboard route not found" });
        return true;
      }
      sendJson(res, 200, section);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/agents") {
      sendJson(res, 200, { ok: true, agents: await listAgents(config) });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/agents/health") {
      sendJson(res, 200, { ok: true, agents: await listAgentHealth(config, queryPositiveInt(url, "stale_after_seconds", 120)) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/agents/register") {
      const body = registerAgentSchema.parse(await readJsonBody(req));
      sendJson(res, 201, { ok: true, agent: await registerAgent(config, body) });
      return true;
    }

    const heartbeatMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);

    if (req.method === "POST" && heartbeatMatch) {
      const body = heartbeatSchema.parse(await readJsonBody(req));
      const agentId = decodePathValue(heartbeatMatch[1]);
      sendJson(res, 200, {
        ...(await recordAgentHeartbeat(config, { agent_id: agentId, ...body }))
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/scheduler/tick") {
      const body = schedulerTickSchema.parse(await readJsonBody(req));
      sendJson(res, 200, await runSchedulerTick(config, body.scheduler_id));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/scheduler/runs") {
      sendJson(res, 200, { ok: true, runs: await listSchedulerRuns(config, queryLimit(url)) });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/scheduler/cron-schedules") {
      sendJson(res, 200, { ok: true, cron_schedules: await listCronSchedules(config, queryLimit(url)) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/scheduler/cron-schedules") {
      const body = cronScheduleSchema.parse(await readJsonBody(req));
      sendJson(res, 201, { ok: true, cron_schedule: await upsertCronSchedule(config, body) });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/scheduler/retry-policies") {
      sendJson(res, 200, { ok: true, retry_policies: await listRetryPolicies(config, queryLimit(url)) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/scheduler/retry-policies") {
      const body = retryPolicySchema.parse(await readJsonBody(req));
      sendJson(res, 201, { ok: true, retry_policy: await upsertRetryPolicy(config, body) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/workflows") {
      const body = createAsyncWorkflowSchema.parse(await readJsonBody(req));
      const output = await createAsyncWorkflow(config, body);
      sendJson(res, 202, { ok: true, workflow: output.workflow, current_task: output.task });
      return true;
    }

    const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);

    if (req.method === "GET" && workflowMatch) {
      const output = await getAsyncWorkflow(config, decodePathValue(workflowMatch[1]));
      if (!output) {
        sendJson(res, 404, { error: "Workflow not found" });
        return true;
      }
      sendJson(res, 200, { ok: true, ...output });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/async-tasks/claim") {
      const body = claimAsyncTaskSchema.parse(await readJsonBody(req));
      sendJson(res, 200, { ok: true, task: await claimAsyncTask(config, body) ?? null });
      return true;
    }

    const asyncResultMatch = url.pathname.match(/^\/api\/async-tasks\/([^/]+)\/result$/);

    if (req.method === "POST" && asyncResultMatch) {
      const body = submitAsyncTaskResultSchema.parse(await readJsonBody(req));
      const output = await submitAsyncTaskResult(config, decodePathValue(asyncResultMatch[1]), body);
      if (!output) {
        sendJson(res, 404, { error: "Task not found" });
        return true;
      }
      sendJson(res, 200, { ok: true, ...output });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/webhooks/github") {
      if (!config.githubWebhookSecret) {
        sendJson(res, 404, { ok: false, error: "GitHub webhook is disabled" });
        return true;
      }

      const rawBody = await readRawBody(req);
      const signature = req.headers["x-hub-signature-256"];
      const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

      if (!verifyGithubWebhookSignature(config.githubWebhookSecret, rawBody, signatureHeader)) {
        sendJson(res, 401, { ok: false, error: "Invalid GitHub webhook signature" });
        return true;
      }

      const payload = parseGithubWebhookBody(rawBody);
      const deliveryHeader = req.headers["x-github-delivery"];
      const eventHeader = req.headers["x-github-event"];
      const normalized = normalizeGithubCiWebhook({
        eventName: Array.isArray(eventHeader) ? eventHeader[0] : eventHeader,
        deliveryId: Array.isArray(deliveryHeader) ? deliveryHeader[0] : deliveryHeader,
        payload
      });

      if (normalized.ignored) {
        sendJson(res, 202, { ok: true, ignored: true, reason: normalized.reason });
        return true;
      }

      const body = githubCiEventSchema.parse(normalized.event);
      sendJson(res, 200, { ok: true, ...(await handleGithubCiEvent(config, body)) });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      sendJson(res, 200, { ok: true, tasks: await listTasks(config) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = createTaskSchema.parse(await readJsonBody(req));
      const task = await createTask(config, body);
      sendJson(res, 201, { ok: true, task, available_transitions: availableTaskTransitions(task.state) });
      return true;
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);

    if (taskMatch && req.method === "GET") {
      const taskId = decodePathValue(taskMatch[1]);
      const task = await getTask(config, taskId);
      if (!task) {
        sendJson(res, 404, { error: "Task not found" });
        return true;
      }
      sendJson(res, 200, { ok: true, task, available_transitions: availableTaskTransitions(task.state) });
      return true;
    }

    if (taskMatch && req.method === "PATCH") {
      const taskId = decodePathValue(taskMatch[1]);
      const body = updateTaskSchema.parse(await readJsonBody(req));
      const task = await updateTask(config, taskId, body);
      sendJson(res, 200, { ok: true, task, available_transitions: availableTaskTransitions(task.state) });
      return true;
    }

    const linksMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/links$/);

    if (linksMatch && req.method === "GET") {
      const taskId = decodePathValue(linksMatch[1]);
      sendJson(res, 200, { ok: true, links: await listTaskLinks(config, taskId) });
      return true;
    }

    if (linksMatch && req.method === "POST") {
      const taskId = decodePathValue(linksMatch[1]);
      const body = createTaskLinkSchema.parse(await readJsonBody(req));
      const link = await createTaskLink(config, taskId, body);
      sendJson(res, 201, { ok: true, link });
      return true;
    }

    const transitionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/transitions$/);

    if (transitionMatch && req.method === "POST") {
      const taskId = decodePathValue(transitionMatch[1]);
      const body = transitionTaskSchema.parse(await readJsonBody(req));
      sendJson(res, 200, { ok: true, ...(await transitionTask(config, taskId, body)) });
      return true;
    }

    const eventsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/events$/);

    if (eventsMatch && req.method === "GET") {
      const taskId = decodePathValue(eventsMatch[1]);
      sendJson(res, 200, { ok: true, events: await listTaskEvents(config, taskId) });
      return true;
    }

    sendJson(res, 404, { error: "AgentOps task route not found" });
    return true;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: error.message });
      return true;
    }

    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }

    if (error instanceof ZodError) {
      sendJson(res, 400, {
        error: "Invalid AgentOps payload",
        details: error.flatten()
      });
      return true;
    }

    const message = error instanceof Error ? error.message : "AgentOps API failed";
    sendJson(res, apiErrorStatus(new Error(message)), { error: message });
    return true;
  }
}
