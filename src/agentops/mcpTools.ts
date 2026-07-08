import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import {
  claimAsyncTask,
  createAsyncWorkflow,
  getAsyncWorkflow,
  handleGithubCiEvent,
  submitAsyncTaskResult
} from "../asyncWorkflowStore.js";
import {
  claimAsyncTaskSchema,
  createAsyncWorkflowSchema,
  githubCiEventSchema,
  submitAsyncTaskResultSchema
} from "../asyncWorkflowSchemas.js";
import { listAgentHealth, listAgents, recordAgentHeartbeat, registerAgent } from "../agents/agentRegistry.js";
import { getOrchestrationDashboardSnapshot } from "../dashboard/orchestrationDashboard.js";
import {
  listCronSchedules,
  listRetryPolicies,
  listSchedulerRuns,
  runSchedulerTick,
  upsertCronSchedule,
  upsertRetryPolicy
} from "../scheduler/orchestrationScheduler.js";
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
import {
  createTaskLinkSchema,
  createTaskSchema,
  transitionTaskSchema,
  updateTaskSchema
} from "./schemas.js";

function textOutput(output: unknown) {
  const structuredContent = output && typeof output === "object" && !Array.isArray(output)
    ? output as Record<string, unknown>
    : { value: output };

  return {
    structuredContent,
    content: [{ type: "text" as const, text: JSON.stringify(output) }]
  };
}

const taskIdSchema = { task_id: z.string().min(1) };

const registerAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  metadata_json: z.record(z.unknown()).default({})
});

const heartbeatSchema = z.object({
  agent_id: z.string().min(1),
  status: z.string().min(1).default("available"),
  current_task_id: z.string().optional(),
  current_lease_id: z.string().optional(),
  queue_depth: z.number().int().nonnegative().optional(),
  remaining_credits: z.number().nonnegative().optional(),
  payload_json: z.record(z.unknown()).default({})
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

export function registerAgentOpsMcpTools(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "task_list",
    {
      title: "List AgentOps tasks",
      description: "List AgentOps tasks, optionally filtered by state.",
      inputSchema: { state: z.string().optional() },
      annotations: { readOnlyHint: true }
    },
    async ({ state }) => {
      const tasks = await listTasks(config);
      return textOutput({ ok: true, tasks: state ? tasks.filter((task) => task.state === state) : tasks });
    }
  );

  server.registerTool(
    "task_get",
    {
      title: "Get AgentOps task",
      description: "Get one AgentOps task by task_id.",
      inputSchema: taskIdSchema,
      annotations: { readOnlyHint: true }
    },
    async ({ task_id }) => textOutput({ ok: true, task: await getTask(config, task_id) ?? null })
  );

  server.registerTool(
    "task_create",
    {
      title: "Create AgentOps task",
      description: "Create a task. Provide idempotency_key from the UI to make retries safe.",
      inputSchema: createTaskSchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput({ ok: true, task: await createTask(config, input) })
  );

  server.registerTool(
    "task_update",
    {
      title: "Update AgentOps task",
      description: "Update basic task fields.",
      inputSchema: { ...taskIdSchema, ...updateTaskSchema.shape },
      annotations: { readOnlyHint: false }
    },
    async ({ task_id, ...input }) => textOutput({ ok: true, task: await updateTask(config, task_id, input) })
  );

  server.registerTool(
    "task_transition",
    {
      title: "Transition AgentOps task",
      description: "Move a task through the task state machine. Use idempotency_key for submit buttons and retry-safe UI calls.",
      inputSchema: { ...taskIdSchema, ...transitionTaskSchema.shape },
      annotations: { readOnlyHint: false }
    },
    async ({ task_id, ...input }) => textOutput({ ok: true, ...(await transitionTask(config, task_id, input)) })
  );

  server.registerTool(
    "task_links_list",
    {
      title: "List AgentOps task links",
      description: "List active links for a task.",
      inputSchema: taskIdSchema,
      annotations: { readOnlyHint: true }
    },
    async ({ task_id }) => textOutput({ ok: true, links: await listTaskLinks(config, task_id) })
  );

  server.registerTool(
    "task_link_create",
    {
      title: "Create AgentOps task link",
      description: "Create a task dependency or relationship link.",
      inputSchema: { ...taskIdSchema, ...createTaskLinkSchema.shape },
      annotations: { readOnlyHint: false }
    },
    async ({ task_id, ...input }) => textOutput({ ok: true, link: await createTaskLink(config, task_id, input) })
  );

  server.registerTool(
    "task_events_list",
    {
      title: "List AgentOps task events",
      description: "List timeline events for a task.",
      inputSchema: taskIdSchema,
      annotations: { readOnlyHint: true }
    },
    async ({ task_id }) => textOutput({ ok: true, events: await listTaskEvents(config, task_id) })
  );

  server.registerTool(
    "async_workflow_create",
    {
      title: "Create async workflow",
      description: "Create a durable async workflow and first task.",
      inputSchema: createAsyncWorkflowSchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput({ ok: true, ...(await createAsyncWorkflow(config, input)) })
  );

  server.registerTool(
    "async_workflow_get",
    {
      title: "Get async workflow",
      description: "Get async workflow detail, tasks, and events.",
      inputSchema: { workflow_id: z.string().min(1) },
      annotations: { readOnlyHint: true }
    },
    async ({ workflow_id }) => textOutput({ ok: true, workflow: await getAsyncWorkflow(config, workflow_id) ?? null })
  );

  server.registerTool(
    "async_task_claim",
    {
      title: "Claim async task",
      description: "Claim the next queued async task matching agent capabilities.",
      inputSchema: claimAsyncTaskSchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput({ ok: true, task: await claimAsyncTask(config, input) ?? null })
  );

  server.registerTool(
    "async_task_submit_result",
    {
      title: "Submit async task result",
      description: "Submit async task result and let State Engine create the next task.",
      inputSchema: { ...taskIdSchema, ...submitAsyncTaskResultSchema.shape },
      annotations: { readOnlyHint: false }
    },
    async ({ task_id, ...input }) => textOutput({ ok: true, ...(await submitAsyncTaskResult(config, task_id, input)) })
  );

  server.registerTool(
    "github_ci_event_handle",
    {
      title: "Handle GitHub CI event",
      description: "Handle a GitHub CI/webhook event for waiting workflows.",
      inputSchema: githubCiEventSchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput({ ok: true, ...(await handleGithubCiEvent(config, input)) })
  );

  server.registerTool(
    "agent_list",
    {
      title: "List registered agents",
      description: "List registered agents and capabilities.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => textOutput({ ok: true, agents: await listAgents(config) })
  );

  server.registerTool(
    "agent_health",
    {
      title: "List agent health",
      description: "List registered agents with heartbeat freshness, current task, remaining credits, and queue stats.",
      inputSchema: { stale_after_seconds: z.number().int().positive().default(120) },
      annotations: { readOnlyHint: true }
    },
    async ({ stale_after_seconds }) => textOutput({ ok: true, agents: await listAgentHealth(config, stale_after_seconds) })
  );

  server.registerTool(
    "agent_register",
    {
      title: "Register agent",
      description: "Register or update an orchestration agent.",
      inputSchema: registerAgentSchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput({ ok: true, agent: await registerAgent(config, input) })
  );

  server.registerTool(
    "agent_heartbeat",
    {
      title: "Record agent heartbeat",
      description: "Record agent liveness, status, current task, queue depth, and remaining credits.",
      inputSchema: heartbeatSchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput(await recordAgentHeartbeat(config, input))
  );

  server.registerTool(
    "scheduler_tick",
    {
      title: "Run scheduler tick",
      description: "Run lease expiry, stale agent detection, and cron schedule checks once.",
      inputSchema: { scheduler_id: z.string().min(1).default("mcp") },
      annotations: { readOnlyHint: false }
    },
    async ({ scheduler_id }) => textOutput(await runSchedulerTick(config, scheduler_id))
  );

  server.registerTool(
    "scheduler_runs_list",
    {
      title: "List scheduler runs",
      description: "List recent scheduler runs and summaries.",
      inputSchema: { limit: z.number().int().positive().max(200).default(50) },
      annotations: { readOnlyHint: true }
    },
    async ({ limit }) => textOutput({ ok: true, runs: await listSchedulerRuns(config, limit) })
  );

  server.registerTool(
    "cron_schedules_list",
    {
      title: "List cron schedules",
      description: "List enabled and disabled cron schedules.",
      inputSchema: { limit: z.number().int().positive().max(200).default(50) },
      annotations: { readOnlyHint: true }
    },
    async ({ limit }) => textOutput({ ok: true, cron_schedules: await listCronSchedules(config, limit) })
  );

  server.registerTool(
    "cron_schedule_upsert",
    {
      title: "Upsert cron schedule",
      description: "Create or update a recurring workflow schedule.",
      inputSchema: cronScheduleSchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput({ ok: true, cron_schedule: await upsertCronSchedule(config, input) })
  );

  server.registerTool(
    "retry_policies_list",
    {
      title: "List retry policies",
      description: "List task retry policies.",
      inputSchema: { limit: z.number().int().positive().max(200).default(50) },
      annotations: { readOnlyHint: true }
    },
    async ({ limit }) => textOutput({ ok: true, retry_policies: await listRetryPolicies(config, limit) })
  );

  server.registerTool(
    "retry_policy_upsert",
    {
      title: "Upsert retry policy",
      description: "Create or update retry policy for a task type.",
      inputSchema: retryPolicySchema.shape,
      annotations: { readOnlyHint: false }
    },
    async (input) => textOutput({ ok: true, retry_policy: await upsertRetryPolicy(config, input) })
  );

  server.registerTool(
    "dashboard_snapshot",
    {
      title: "Get orchestration dashboard snapshot",
      description: "Get workflows, task queue, waiting tasks, failures, agents, scheduler state, webhooks, and events.",
      inputSchema: { limit: z.number().int().positive().max(200).default(50) },
      annotations: { readOnlyHint: true }
    },
    async ({ limit }) => textOutput(await getOrchestrationDashboardSnapshot(config, limit))
  );
}
