import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { agentResultSchema } from "./schemas.js";
import { forwardAgentResultToBackend } from "./tools/backendClient.js";
import { getDesignRequest, submitAgentResult } from "./tools/designSystemStore.js";
import {
  githubCommentPullRequest,
  githubCreateBranch,
  githubCreatePullRequest,
  githubGetRepo,
  githubGetWorkflowRuns,
  githubReadFile,
  githubUpsertFile
} from "./tools/githubClient.js";

const config = loadConfig();

type JsonRecord = Record<string, unknown>;

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, mcp-session-id"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!config.mcpBearerToken) return true;
  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${config.mcpBearerToken}`;
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody) as unknown;
}

function repoRoute(url: URL, suffix = ""): RegExpMatchArray | null {
  const normalizedSuffix = suffix ? `/${suffix}` : "";
  return url.pathname.match(new RegExp(`^/api/github/repos/([^/]+)/([^/]+)${normalizedSuffix}$`));
}

function repoInput(match: RegExpMatchArray): { owner: string; repo: string } {
  return {
    owner: decodeURIComponent(match[1] ?? ""),
    repo: decodeURIComponent(match[2] ?? "")
  };
}

async function handleGitHubRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/github/")) return false;

  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  try {
    const repoMatch = repoRoute(url);

    if (req.method === "GET" && repoMatch) {
      sendJson(res, 200, await githubGetRepo(config, repoInput(repoMatch)));
      return true;
    }

    const fileMatch = repoRoute(url, "files");

    if (req.method === "GET" && fileMatch) {
      const path = url.searchParams.get("path") || "";
      const ref = url.searchParams.get("ref") || undefined;
      sendJson(
        res,
        200,
        await githubReadFile(config, {
          ...repoInput(fileMatch),
          path,
          ref
        })
      );
      return true;
    }

    const branchMatch = repoRoute(url, "branches");

    if (req.method === "POST" && branchMatch) {
      const body = asRecord(await readJsonBody(req));
      sendJson(
        res,
        200,
        await githubCreateBranch(config, {
          ...repoInput(branchMatch),
          branch: asString(body.branch),
          from_branch: asString(body.from_branch) || undefined
        })
      );
      return true;
    }

    if (req.method === "POST" && fileMatch) {
      const body = asRecord(await readJsonBody(req));
      sendJson(
        res,
        200,
        await githubUpsertFile(config, {
          ...repoInput(fileMatch),
          path: asString(body.path),
          content: asString(body.content),
          branch: asString(body.branch),
          message: asString(body.message)
        })
      );
      return true;
    }

    const prMatch = repoRoute(url, "pull-requests");

    if (req.method === "POST" && prMatch) {
      const body = asRecord(await readJsonBody(req));
      sendJson(
        res,
        200,
        await githubCreatePullRequest(config, {
          ...repoInput(prMatch),
          title: asString(body.title),
          head: asString(body.head),
          base: asString(body.base) || undefined,
          body: asString(body.body) || undefined,
          draft: asBoolean(body.draft)
        })
      );
      return true;
    }

    const workflowMatch = repoRoute(url, "workflow-runs");

    if (req.method === "GET" && workflowMatch) {
      sendJson(
        res,
        200,
        await githubGetWorkflowRuns(config, {
          ...repoInput(workflowMatch),
          branch: url.searchParams.get("branch") || undefined,
          per_page: asNumber(Number(url.searchParams.get("per_page") || 10), 10)
        })
      );
      return true;
    }

    const commentMatch = url.pathname.match(
      /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/comments$/
    );

    if (req.method === "POST" && commentMatch) {
      const body = asRecord(await readJsonBody(req));
      sendJson(
        res,
        200,
        await githubCommentPullRequest(config, {
          owner: decodeURIComponent(commentMatch[1] ?? ""),
          repo: decodeURIComponent(commentMatch[2] ?? ""),
          pr_number: Number(commentMatch[3]),
          body: asString(body.body)
        })
      );
      return true;
    }

    sendJson(res, 404, { error: "GitHub API route not found" });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub API failed";
    const status = message.includes("not configured") ? 500 : 400;
    sendJson(res, status, { error: message });
    return true;
  }
}

async function handleRestApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  const handledGitHubApi = await handleGitHubRestApi(req, res, url);
  if (handledGitHubApi) return true;

  const designRequestMatch = url.pathname.match(/^\/api\/design-requests\/([^/]+)$/);

  if (req.method === "GET" && designRequestMatch) {
    setCorsHeaders(res);
    const requestId = decodeURIComponent(designRequestMatch[1] ?? "");
    const designRequest = await getDesignRequest(requestId);

    if (designRequest.status === "not_found") {
      sendJson(res, 404, designRequest);
      return true;
    }

    sendJson(res, 200, designRequest);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent-results") {
    setCorsHeaders(res);

    try {
      const body = await readJsonBody(req);
      const parsed = agentResultSchema.parse(body);

      await submitAgentResult(parsed);
      const forwardResult = await forwardAgentResultToBackend(config, parsed);

      sendJson(res, 200, {
        ok: true,
        request_id: parsed.request_id,
        stored: true,
        forwarded_to_backend: forwardResult.forwarded,
        backend_status: forwardResult.status
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return true;
      }

      if (error instanceof ZodError) {
        sendJson(res, 400, {
          error: "Invalid agent result payload",
          details: error.flatten()
        });
        return true;
      }

      console.error("REST agent result failed", error);
      sendJson(res, 500, { error: "Internal server error" });
    }

    return true;
  }

  return false;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    return sendJson(res, 200, {
      ok: true,
      service: "design-system-mcp",
      mcp_path: config.mcpPath,
      rest_paths: [
        "/api/design-requests/{request_id}",
        "/api/agent-results",
        "/api/github/repos/{owner}/{repo}",
        "/api/github/repos/{owner}/{repo}/files",
        "/api/github/repos/{owner}/{repo}/branches",
        "/api/github/repos/{owner}/{repo}/pull-requests",
        "/api/github/repos/{owner}/{repo}/workflow-runs"
      ]
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  const handledRestApi = await handleRestApi(req, res, url);
  if (handledRestApi) return;

  if (url.pathname !== config.mcpPath) {
    return sendJson(res, 404, { error: "Not found" });
  }

  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  if (!req.method || !["POST", "GET", "DELETE"].includes(req.method)) {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const mcpServer = createMcpServer(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on("close", () => {
    transport.close();
    mcpServer.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) {
      return sendJson(res, 500, { error: "Internal server error" });
    }
  }
});

httpServer.listen(config.port, () => {
  console.log(`Design System MCP listening on http://localhost:${config.port}${config.mcpPath}`);
});
