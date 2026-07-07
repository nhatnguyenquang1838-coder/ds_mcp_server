import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
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

export type AgentOpsRouterDeps = {
  config: AppConfig;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  setCorsHeaders: (res: ServerResponse) => void;
  readJsonBody: (req: IncomingMessage) => Promise<unknown>;
};

function decodePathValue(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}

function apiErrorStatus(error: Error): number {
  if (error.message.includes("not configured")) return 500;
  if (error.message.includes("not found") || error.message.includes("not found")) return 404;
  if (error.message.includes("Invalid transition") || error.message.includes("open blockers")) return 409;
  return 400;
}

function isAgentOpsPath(pathname: string): boolean {
  return pathname.startsWith("/api/tasks") || pathname.startsWith("/api/workflows") || pathname.startsWith("/api/async-tasks") || pathname === "/api/webhooks/github";
}

export async function handleAgentOpsRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AgentOpsRouterDeps
): Promise<boolean> {
  const { config, sendJson, setCorsHeaders, readJsonBody } = deps;

  if (!isAgentOpsPath(url.pathname)) return false;

  setCorsHeaders(res);

  try {
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
      const body = githubCiEventSchema.parse(await readJsonBody(req));
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
