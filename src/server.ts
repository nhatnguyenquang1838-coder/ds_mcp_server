import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import {
  agentResultSchema,
  githubCommentPullRequestSchema,
  githubCreateBranchSchema,
  githubCreatePullRequestSchema,
  githubUpsertFileSchema,
  workspaceAgentRunResultSchema,
  workspaceAgentRunTriggerSchema
} from "./schemas.js";
import { forwardAgentResultToBackend } from "./tools/backendClient.js";
import { getDesignRequest, submitAgentResult } from "./tools/designSystemStore.js";
import {
  githubCommentPullRequest,
  githubCreateBranch,
  githubCreatePullRequest,
  githubDownloadArchiveZip,
  githubDownloadWorkflowArtifactZip,
  githubGetRepo,
  githubGetWorkflowRuns,
  githubListWorkflowRunArtifacts,
  githubReadFile,
  githubUpsertFile
} from "./tools/githubClient.js";
import { writeAuditEvent } from "./tools/auditLog.js";
import {
  completeAgentRun,
  createAgentRun,
  getAgentRun,
  markAgentRunTriggered,
  markAgentRunTriggering
} from "./tools/agentRunStore.js";
import { triggerWorkspaceAgent } from "./tools/workspaceAgentClient.js";
import { handleAgentOpsRestApi } from "./agentops/router.js";
import { handleGitHubUploadRestApi } from "./githubUploadRouter.js";
import { acquireRateLimit } from "./security/rateLimit.js";
import { authorizeRoute } from "./security/auth.js";
import { resolveRoutePolicy } from "./security/routePolicy.js";
import {
  formatSecurityStartupError,
  validateSecurityStartup
} from "./security/startupValidation.js";
import { redactValue } from "./security/redaction.js";
import {
  PayloadTooLargeError,
  readJsonBody as readJsonBodyWithLimit,
  readRawBody as readRawBodyWithLimit
} from "./security/requestLimits.js";

const config = loadConfig();
const securityStartup = validateSecurityStartup(config);
const serviceVersion = "0.7.0";
const publicRoot = resolve(process.cwd(), "public");

if (!securityStartup.ok) {
  console.error(formatSecurityStartupError(securityStartup.issues, securityStartup.summary));
  process.exit(1);
}

type UpstreamCallBucket = {
  upstream: string;
  method: string;
  path: string;
  count: number;
  last_seen_at: string;
  last_user_agent?: string;
};

const upstreamCallBuckets = new Map<string, UpstreamCallBucket>();
const upstreamCallStartedAt = new Date().toISOString();
let upstreamCallTotal = 0;

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sendHtml(
  res: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

function contentTypeForFile(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hashForComparison(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsMatch(expected: string, actual: string): boolean {
  const expectedHash = hashForComparison(expected);
  const actualHash = hashForComparison(actual);
  if (expectedHash.length !== actualHash.length) return false;
  return timingSafeEqual(expectedHash, actualHash);
}

function normalizeMcpPath(mcpPath: string): string {
  if (!mcpPath || mcpPath === "/") return "/";
  return mcpPath.replace(/\/+$/, "");
}

function mcpUrlSecretFromPathname(mcpPath: string, pathname: string): string | undefined {
  const normalizedMcpPath = normalizeMcpPath(mcpPath);
  if (normalizedMcpPath === "/") return undefined;

  const prefix = `${normalizedMcpPath}/`;
  if (!pathname.startsWith(prefix)) return undefined;

  const encodedSecret = pathname.slice(prefix.length);
  if (!encodedSecret || encodedSecret.includes("/")) return undefined;

  return decodeURIComponent(encodedSecret);
}

function isMcpRequestPath(mcpPath: string, pathname: string): boolean {
  const normalizedMcpPath = normalizeMcpPath(mcpPath);
  if (pathname === normalizedMcpPath) return true;
  return mcpUrlSecretFromPathname(normalizedMcpPath, pathname) !== undefined;
}

function requestId(req: IncomingMessage): string {
  return firstHeader(req.headers["x-request-id"])?.trim() || randomUUID();
}

function clientKey(req: IncomingMessage): string {
  const forwarded = firstHeader(req.headers["x-forwarded-for"]);
  if (forwarded?.trim()) {
    return forwarded.split(",")[0]?.trim() || forwarded.trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function isAllowedOrigin(origin: string): boolean {
  return config.securityEnforcement !== "strict" || config.corsAllowedOrigins.includes(origin);
}

function setCorsHeaders(reqOrRes: IncomingMessage | ServerResponse, maybeRes?: ServerResponse): void {
  const req = maybeRes ? (reqOrRes as IncomingMessage) : undefined;
  const res = maybeRes ?? (reqOrRes as ServerResponse);
  const origin = req ? firstHeader(req.headers.origin) : undefined;

  if (config.securityEnforcement !== "strict") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
  } else if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, PUT, GET, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, mcp-session-id, x-github-delivery, x-github-event, x-hub-signature-256, x-request-id"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Content-Disposition, X-Request-Id");
}

function sendDenied(
  res: ServerResponse,
  req: IncomingMessage,
  status: 401 | 403 | 429,
  error: string
): void {
  const requestIdValue = requestId(req);
  sendJson(res, status, { error, request_id: requestIdValue }, { "X-Request-Id": requestIdValue });
}

function logSecurityDenial(input: {
  requestId: string;
  routeId: string;
  principalType: string;
  principalId?: string;
  status: 401 | 403 | 429;
  reason: string;
  method: string;
  pathname: string;
}): void {
  writeAuditEvent({
    action: input.status === 429 ? "security_rate_limited" : "security_auth_denied",
    source: "rest",
    request_id: input.requestId,
    route_id: input.routeId,
    principal_type: input.principalType,
    principal_id: input.principalId,
    status: "failure",
    reason: input.reason,
    target: {
      method: input.method,
      path: input.pathname
    }
  });
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return readRawBodyWithLimit(req, config.maxJsonBodyBytes);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return readJsonBodyWithLimit(req, config.maxJsonBodyBytes);
}

async function handleAdminStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return false;

  const relativePath =
    url.pathname === "/admin" || url.pathname === "/admin/"
      ? "admin/index.html"
      : `admin/${url.pathname.slice("/admin/".length)}`;

  const filePath = resolve(publicRoot, relativePath);
  const relativeToRoot = relative(publicRoot, filePath);
  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
    sendJson(res, 400, { error: "Invalid admin asset path" });
    return true;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": contentTypeForFile(filePath),
      "content-length": String(body.byteLength)
    });

    if (req.method === "HEAD") {
      res.end();
      return true;
    }

    res.end(body);
    return true;
  } catch {
    sendJson(res, 404, { error: "Admin page not found" });
    return true;
  }
}

function sendBinary(
  res: ServerResponse,
  statusCode: number,
  body: Buffer,
  options: { contentType: string; fileName: string }
): void {
  res.writeHead(statusCode, {
    "content-type": options.contentType,
    "content-length": String(body.byteLength),
    "content-disposition": `attachment; filename="${options.fileName}"`
  });
  res.end(body);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parsePositiveInt(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
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

function requestBaseUrl(req: IncomingMessage): string {
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/$/, "");

  const proto = firstHeader(req.headers["x-forwarded-proto"]) || "https";
  const host = firstHeader(req.headers["x-forwarded-host"]) || req.headers.host || "localhost";
  return `${proto}://${host}`.replace(/\/$/, "");
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  return firstHeader(req.headers[name.toLowerCase()]);
}

function normalizePathForDashboard(pathname: string): string {
  return pathname
    .replace(/^\/api\/design-requests\/[^/]+$/, "/api/design-requests/{request_id}")
    .replace(/^\/api\/agent-runs\/[^/]+$/, "/api/agent-runs/{run_id}")
    .replace(/^\/internal\/agent-runs\/[^/]+\/result$/, "/internal/agent-runs/{run_id}/result")
    .replace(/^\/api\/github\/repos\/([^/]+)\/([^/]+)\/pull-requests\/\d+\/comments$/, "/api/github/repos/{owner}/{repo}/pull-requests/{pr_number}/comments")
    .replace(/^\/api\/github\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/\d+\/artifacts$/, "/api/github/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts")
    .replace(/^\/api\/github\/repos\/([^/]+)\/([^/]+)\/actions\/artifacts\/\d+\/zip$/, "/api/github/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip")
    .replace(/^\/api\/github\/repos\/([^/]+)\/([^/]+)(\/.*)?$/, (_match, _owner, _repo, suffix) => {
      return `/api/github/repos/{owner}/{repo}${suffix ?? ""}`;
    });
}

function inferUpstream(req: IncomingMessage): string {
  const explicitSource =
    headerValue(req, "x-upstream") ||
    headerValue(req, "x-source") ||
    headerValue(req, "x-client-name") ||
    headerValue(req, "x-chatgpt-connector-name");

  if (explicitSource?.trim()) return explicitSource.trim();

  const referer = headerValue(req, "referer");
  if (referer) {
    try {
      return new URL(referer).hostname;
    } catch {
      return referer;
    }
  }

  const forwardedHost = headerValue(req, "x-forwarded-host");
  if (forwardedHost?.trim()) return forwardedHost.trim();

  const userAgent = headerValue(req, "user-agent");
  if (userAgent?.includes("ChatGPT")) return "chatgpt";
  if (userAgent?.includes("curl")) return "curl";

  return "unknown";
}

function trackUpstreamCall(req: IncomingMessage, url: URL): void {
  if (url.pathname === "/dashboard/upstream-calls" || url.pathname === "/api/dashboard/upstream-calls") {
    return;
  }

  const method = req.method || "UNKNOWN";
  const path = normalizePathForDashboard(url.pathname);
  const upstream = inferUpstream(req);
  const key = `${upstream}\u0000${method}\u0000${path}`;
  const now = new Date().toISOString();
  const current = upstreamCallBuckets.get(key);

  upstreamCallTotal += 1;

  if (current) {
    current.count += 1;
    current.last_seen_at = now;
    current.last_user_agent = headerValue(req, "user-agent");
    return;
  }

  upstreamCallBuckets.set(key, {
    upstream,
    method,
    path,
    count: 1,
    last_seen_at: now,
    last_user_agent: headerValue(req, "user-agent")
  });
}

function getUpstreamCallDashboard(limit = 50) {
  const buckets = [...upstreamCallBuckets.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });

  const by_upstream = new Map<string, { upstream: string; count: number; last_seen_at: string }>();
  for (const bucket of buckets) {
    const current = by_upstream.get(bucket.upstream);
    if (current) {
      current.count += bucket.count;
      if (bucket.last_seen_at > current.last_seen_at) current.last_seen_at = bucket.last_seen_at;
    } else {
      by_upstream.set(bucket.upstream, {
        upstream: bucket.upstream,
        count: bucket.count,
        last_seen_at: bucket.last_seen_at
      });
    }
  }

  return {
    ok: true,
    service: "design-system-mcp",
    started_at: upstreamCallStartedAt,
    generated_at: new Date().toISOString(),
    total_calls: upstreamCallTotal,
    unique_buckets: buckets.length,
    by_upstream: [...by_upstream.values()].sort((a, b) => b.count - a.count),
    calls: buckets.slice(0, limit)
  };
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderUpstreamDashboardHtml(): string {
  const dashboard = getUpstreamCallDashboard(100);
  const rows = dashboard.calls
    .map((call) => {
      return `<tr><td>${escapeHtml(call.upstream)}</td><td><code>${escapeHtml(call.method)}</code></td><td><code>${escapeHtml(call.path)}</code></td><td>${call.count}</td><td>${escapeHtml(call.last_seen_at)}</td><td class="muted">${escapeHtml(call.last_user_agent || "")}</td></tr>`;
    })
    .join("");
  const bodyRows = rows || '<tr><td colspan="6" class="muted">No upstream calls recorded yet.</td></tr>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta http-equiv="refresh" content="10"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Upstream Call Dashboard</title><style>:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{margin:0;padding:32px;background:#0f172a;color:#e2e8f0}h1{margin:0 0 8px;font-size:28px}p{color:#94a3b8;margin:0 0 24px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.card{background:#111827;border:1px solid #334155;border-radius:16px;padding:16px}.label{color:#94a3b8;font-size:13px}.value{font-size:28px;font-weight:700;margin-top:4px}table{width:100%;border-collapse:collapse;background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #334155;vertical-align:top}th{color:#cbd5e1;background:#1e293b;font-size:13px}td{color:#e2e8f0;font-size:13px}code{color:#bfdbfe}.muted{color:#94a3b8}</style></head><body><h1>Upstream Call Dashboard</h1><p>Inbound request counts grouped by upstream/source, method, and normalized route. Data is in-memory and resets on server restart. This page refreshes every 10 seconds.</p><div class="cards"><div class="card"><div class="label">Total calls</div><div class="value">${dashboard.total_calls}</div></div><div class="card"><div class="label">Upstreams</div><div class="value">${dashboard.by_upstream.length}</div></div><div class="card"><div class="label">Route buckets</div><div class="value">${dashboard.unique_buckets}</div></div></div><table><thead><tr><th>Upstream</th><th>Method</th><th>Route</th><th>Calls</th><th>Last seen</th><th>User agent</th></tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
}

function agentRunPublicView(run: ReturnType<typeof getAgentRun>) {
  if (!run) return undefined;
  return {
    id: run.id,
    agent_type: run.agent_type,
    request_id: run.request_id,
    mode: run.mode,
    conversation_key: run.conversation_key,
    status: run.status,
    trigger_status_code: run.trigger_status_code,
    trigger_error: run.trigger_error,
    result_json: run.result_json,
    created_at: run.created_at,
    triggered_at: run.triggered_at,
    completed_at: run.completed_at
  };
}

function getCapabilities() {
  return {
    ok: true,
    service: "design-system-mcp",
    version: serviceVersion,
    mcp_path: config.mcpPath,
    security: {
      enforcement: config.securityEnforcement,
      startup_validated: securityStartup.ok,
      cors_allowed_origins: config.securityEnforcement === "strict" ? config.corsAllowedOrigins : ["*"],
      mcp_url_secret_configured: Boolean(config.mcpUrlSecret),
      max_json_body_bytes: config.maxJsonBodyBytes,
      rate_limit_window_ms: config.rateLimitWindowMs,
      rate_limit_max_requests: config.rateLimitMaxRequests
    },
    mcp_tools: [
      "ds_ping",
      "ds_get_request",
      "ds_submit_agent_result",
      "github_get_repo",
      "github_read_file",
      "github_create_branch",
      "github_upsert_file",
      "github_create_pr",
      "github_get_workflow_runs",
      "github_comment_pr"
    ],
    rest_paths: [
      "/api/capabilities",
      "/api/dashboard/upstream-calls",
      "/api/webhooks/github",
      "/dashboard/upstream-calls",
      "/api/tasks",
      "/api/tasks/{task_id}",
      "/api/tasks/{task_id}/links",
      "/api/tasks/{task_id}/transitions",
      "/api/tasks/{task_id}/events",
      "/api/agent-runs",
      "/api/agent-runs/{run_id}",
      "/internal/agent-runs/{run_id}/result",
      "/api/design-requests/{request_id}",
      "/api/agent-results",
      "/api/github/repos/{owner}/{repo}",
      "/api/github/repos/{owner}/{repo}/files",
      "/api/github/repos/{owner}/{repo}/branches",
      "/api/github/repos/{owner}/{repo}/pull-requests",
      "/api/github/repos/{owner}/{repo}/pull-requests/{pr_number}/comments",
      "/api/github/repos/{owner}/{repo}/workflow-runs",
      "/api/github/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
      "/api/github/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip",
      "/api/github/repos/{owner}/{repo}/archive",
      "/api/github/repos/{owner}/{repo}/upload-sessions",
      "/api/github/repos/{owner}/{repo}/upload-sessions/{session_id}",
      "/api/github/repos/{owner}/{repo}/upload-sessions/{session_id}/chunks/{part_number}",
      "/api/github/repos/{owner}/{repo}/upload-sessions/{session_id}/complete",
      "/api/github/repos/{owner}/{repo}/upload-sessions/{session_id}/commit"
    ],
    guardrails: {
      github_allowed_repos: config.githubAllowedRepos,
      github_default_base_branch: config.githubDefaultBaseBranch,
      github_allowed_branch_prefixes: config.githubAllowedBranchPrefixes,
      github_max_file_bytes: config.githubMaxFileBytes,
      ds_upload_session_ttl_seconds: config.dsUploadSessionTtlSeconds,
      ds_upload_chunk_max_bytes: config.dsUploadChunkMaxBytes,
      ds_upload_max_file_bytes: config.dsUploadMaxFileBytes,
      ds_upload_storage: config.dsUploadStorage,
      protected_branches: ["main", "master", "production", "prod"]
    },
    auth: {
      mcp_bearer_token_configured: Boolean(config.mcpBearerToken),
      mcp_url_secret_configured: Boolean(config.mcpUrlSecret),
      rest_api_bearer_token_configured: Boolean(config.restApiBearerToken),
      github_token_configured: Boolean(config.githubToken),
      github_webhook_secret_configured: Boolean(config.githubWebhookSecret),
      workspace_agent_trigger_configured: Boolean(
        config.workspaceAgentTriggerId && config.workspaceAgentToken
      ),
      workspace_agent_callback_token_configured: Boolean(config.workspaceAgentCallbackToken),
      supabase_configured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey)
    }
  };
}

type SecurityContext = {
  requestId: string;
  routeId: string;
  principalType: string;
  principalId?: string;
};

async function enforceSecurity(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<SecurityContext | null> {
  const method = req.method || "GET";
  const requestIdValue = requestId(req);
  const origin = firstHeader(req.headers.origin);

  res.setHeader("X-Request-Id", requestIdValue);
  setSecurityHeaders(res);
  setCorsHeaders(req, res);

  const mcpUrlSecret = mcpUrlSecretFromPathname(config.mcpPath, url.pathname);
  if (mcpUrlSecret) {
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return null;
    }

    if (config.securityEnforcement === "strict" && origin && !isAllowedOrigin(origin)) {
      logSecurityDenial({
        requestId: requestIdValue,
        routeId: "mcp.connector_secret",
        principalType: "public",
        status: 403,
        reason: "origin_not_allowed",
        method,
        pathname: url.pathname
      });
      sendDenied(res, req, 403, "Origin not allowed");
      return null;
    }

    if (!config.mcpUrlSecret || !secretsMatch(config.mcpUrlSecret, mcpUrlSecret)) {
      sendJson(res, 404, { error: "Not found", request_id: requestIdValue }, { "X-Request-Id": requestIdValue });
      return null;
    }

    return {
      requestId: requestIdValue,
      routeId: "mcp.connector_secret",
      principalType: "mcp_url_secret",
      principalId: "path-secret"
    };
  }

  const securityRoute = resolveRoutePolicy(method, url.pathname);

  if (securityRoute.sensitive && origin && config.securityEnforcement === "strict" && !isAllowedOrigin(origin)) {
    logSecurityDenial({
      requestId: requestIdValue,
      routeId: securityRoute.routeId,
      principalType: "public",
      status: 403,
      reason: "origin_not_allowed",
      method,
      pathname: url.pathname
    });
    sendDenied(res, req, 403, "Origin not allowed");
    return null;
  }

  if (
    method === "OPTIONS" &&
    (url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/internal/") ||
      url.pathname === config.mcpPath ||
      url.pathname.startsWith("/dashboard/") ||
      url.pathname.startsWith("/admin"))
  ) {
    res.writeHead(204);
    res.end();
    return null;
  }

  if (url.pathname === config.mcpPath && config.mcpUrlSecret && !config.mcpBearerToken) {
    sendJson(res, 404, { error: "Not found", request_id: requestIdValue }, { "X-Request-Id": requestIdValue });
    return null;
  }

  if (securityRoute.sensitive && securityRoute.policy === "disabled") {
    logSecurityDenial({
      requestId: requestIdValue,
      routeId: securityRoute.routeId,
      principalType: "public",
      status: 403,
      reason: "missing_route_policy",
      method,
      pathname: url.pathname
    });
    sendDenied(res, req, 403, "Forbidden");
    return null;
  }

  const authDecision = authorizeRoute(config, securityRoute.policy, req);
  if (!authDecision.ok) {
    logSecurityDenial({
      requestId: requestIdValue,
      routeId: securityRoute.routeId,
      principalType: "public",
      status: authDecision.status,
      reason: authDecision.error,
      method,
      pathname: url.pathname
    });
    sendDenied(res, req, authDecision.status, authDecision.error);
    return null;
  }

  if (securityRoute.sensitive && securityRoute.policy !== "webhook_signature") {
    const rateLimit = await acquireRateLimit(config, {
      routeId: securityRoute.routeId,
      principalId: authDecision.principal.id,
      clientKey: clientKey(req)
    });

    if (!rateLimit.allowed) {
      logSecurityDenial({
        requestId: requestIdValue,
        routeId: securityRoute.routeId,
        principalType: authDecision.principal.type,
        principalId: authDecision.principal.id,
        status: 429,
        reason: "rate_limited",
        method,
        pathname: url.pathname
      });
      sendDenied(res, req, 429, "Too Many Requests");
      return null;
    }
  }

  return {
    requestId: requestIdValue,
    routeId: securityRoute.routeId,
    principalType: authDecision.principal.type,
    principalId: authDecision.principal.id
  };
}

async function handleWorkspaceAgentCallback(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const callbackMatch = url.pathname.match(/^\/internal\/agent-runs\/([^/]+)\/result$/);
  if (!callbackMatch) return false;

  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  try {
    const runId = decodeURIComponent(callbackMatch[1] ?? "");
    const body = workspaceAgentRunResultSchema.parse(await readJsonBody(req));
    const run = completeAgentRun(runId, body);

    if (!run) {
      sendJson(res, 404, { error: "Agent run not found" });
      return true;
    }

    writeAuditEvent({
      action: "workspace_agent_callback",
      source: "workspace-agent",
      request_id: run.request_id,
      run_id: run.id,
      status: body.status === "failed" ? "failure" : "success",
      message: body.error
    });

    sendJson(res, 200, {
      ok: true,
      run_id: run.id,
      status: run.status
    });
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
        error: "Invalid workspace agent callback payload",
        details: error.flatten()
      });
      return true;
    }

    sendJson(res, 500, { error: "Internal server error" });
    return true;
  }
}

async function handleWorkspaceAgentRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const runMatch = url.pathname.match(/^\/api\/agent-runs\/([^/]+)$/);

  if (req.method === "GET" && runMatch) {
    setCorsHeaders(req, res);
    const run = agentRunPublicView(getAgentRun(decodeURIComponent(runMatch[1] ?? "")));
    if (!run) {
      sendJson(res, 404, { error: "Agent run not found" });
      return true;
    }
    sendJson(res, 200, run);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent-runs") {
    setCorsHeaders(req, res);

    try {
      const body = workspaceAgentRunTriggerSchema.parse(await readJsonBody(req));
      const run = createAgentRun(body);
      markAgentRunTriggering(run.id);

      const callbackUrl = `${requestBaseUrl(req)}/internal/agent-runs/${encodeURIComponent(run.id)}/result`;
      const triggerResult = await triggerWorkspaceAgent(config, run, callbackUrl);
      const triggeredRun = markAgentRunTriggered(run.id, triggerResult.status_code) ?? run;

      writeAuditEvent({
        action: "workspace_agent_trigger",
        source: "rest",
        request_id: run.request_id,
        run_id: run.id,
        status: "success"
      });

      sendJson(res, 202, {
        ok: true,
        run: agentRunPublicView(triggeredRun),
        trigger: triggerResult
      });
      return true;
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { error: error.message });
        return true;
      }

      const message = error instanceof Error ? error.message : "Workspace agent trigger failed";
      writeAuditEvent({
        action: "workspace_agent_trigger",
        source: "rest",
        status: "failure",
        message
      });

      if (error instanceof SyntaxError) {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return true;
      }

      if (error instanceof ZodError) {
        sendJson(res, 400, {
          error: "Invalid workspace agent trigger payload",
          details: error.flatten()
        });
        return true;
      }

      sendJson(res, message.includes("not configured") ? 500 : 502, { error: message });
      return true;
    }
  }

  return false;
}

async function handleGitHubRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/github/")) return false;

  setCorsHeaders(req, res);

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

    const handledUploadGateway = await handleGitHubUploadRestApi(req, res, url, {
      config,
      sendJson,
      readJsonBody
    });
    if (handledUploadGateway) return true;

    const archiveMatch = repoRoute(url, "archive");

    if (req.method === "GET" && archiveMatch) {
      const output = await githubDownloadArchiveZip(config, {
        ...repoInput(archiveMatch),
        ref: url.searchParams.get("ref") || undefined
      });
      sendBinary(res, 200, output.content, {
        contentType: output.content_type,
        fileName: output.file_name
      });
      return true;
    }

    const runArtifactsMatch = url.pathname.match(
      /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/artifacts$/
    );

    if (req.method === "GET" && runArtifactsMatch) {
      sendJson(
        res,
        200,
        await githubListWorkflowRunArtifacts(config, {
          owner: decodeURIComponent(runArtifactsMatch[1] ?? ""),
          repo: decodeURIComponent(runArtifactsMatch[2] ?? ""),
          run_id: parsePositiveInt(runArtifactsMatch[3], "run_id"),
          per_page: asNumber(Number(url.searchParams.get("per_page") || 30), 30)
        })
      );
      return true;
    }

    const artifactZipMatch = url.pathname.match(
      /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/actions\/artifacts\/(\d+)\/zip$/
    );

    if (req.method === "GET" && artifactZipMatch) {
      const output = await githubDownloadWorkflowArtifactZip(config, {
        owner: decodeURIComponent(artifactZipMatch[1] ?? ""),
        repo: decodeURIComponent(artifactZipMatch[2] ?? ""),
        artifact_id: parsePositiveInt(artifactZipMatch[3], "artifact_id")
      });
      sendBinary(res, 200, output.content, {
        contentType: output.content_type,
        fileName: output.file_name
      });
      return true;
    }

    const branchMatch = repoRoute(url, "branches");

    if (req.method === "POST" && branchMatch) {
      const body = githubCreateBranchSchema.parse(await readJsonBody(req));
      const output = await githubCreateBranch(config, {
        ...repoInput(branchMatch),
        branch: body.branch,
        from_branch: body.from_branch
      });
      writeAuditEvent({
        action: "github_create_branch",
        source: "rest",
        owner: output.owner,
        repo: output.repo,
        branch: output.branch,
        status: "success"
      });
      sendJson(res, 200, output);
      return true;
    }

    if (req.method === "POST" && fileMatch) {
      const body = githubUpsertFileSchema.parse(await readJsonBody(req));
      const output = await githubUpsertFile(config, {
        ...repoInput(fileMatch),
        path: body.path,
        content: body.content,
        branch: body.branch,
        message: body.message
      });
      writeAuditEvent({
        action: "github_upsert_file",
        source: "rest",
        owner: output.owner,
        repo: output.repo,
        branch: output.branch,
        path: output.path,
        status: "success"
      });
      sendJson(res, 200, output);
      return true;
    }

    const prMatch = repoRoute(url, "pull-requests");

    if (req.method === "POST" && prMatch) {
      const body = githubCreatePullRequestSchema.parse(await readJsonBody(req));
      const output = await githubCreatePullRequest(config, {
        ...repoInput(prMatch),
        title: body.title,
        head: body.head,
        base: body.base,
        body: body.body,
        draft: body.draft
      });
      writeAuditEvent({
        action: "github_create_pr",
        source: "rest",
        owner: decodeURIComponent(prMatch[1] ?? ""),
        repo: decodeURIComponent(prMatch[2] ?? ""),
        branch: body.head,
        pr_number: output.number,
        status: "success"
      });
      sendJson(res, 200, output);
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
      const body = githubCommentPullRequestSchema.parse(await readJsonBody(req));
      const output = await githubCommentPullRequest(config, {
        owner: decodeURIComponent(commentMatch[1] ?? ""),
        repo: decodeURIComponent(commentMatch[2] ?? ""),
        pr_number: Number(commentMatch[3]),
        body: body.body
      });
      writeAuditEvent({
        action: "github_comment_pr",
        source: "rest",
        owner: decodeURIComponent(commentMatch[1] ?? ""),
        repo: decodeURIComponent(commentMatch[2] ?? ""),
        pr_number: Number(commentMatch[3]),
        status: "success"
      });
      sendJson(res, 200, output);
      return true;
    }

    sendJson(res, 404, { error: "GitHub API route not found" });
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
        error: "Invalid GitHub payload",
        details: error.flatten()
      });
      return true;
    }

    const message = error instanceof Error ? error.message : "GitHub API failed";
    const status = message.includes("not configured") ? 500 : 400;
    sendJson(res, status, { error: message });
    return true;
  }
}

async function handleDashboardApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/dashboard/upstream-calls") {
    setCorsHeaders(req, res);
    const limit = asNumber(Number(url.searchParams.get("limit") || 50), 50);
    sendJson(res, 200, getUpstreamCallDashboard(limit));
    return true;
  }

  return false;
}

async function handleRestApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/capabilities") {
    setCorsHeaders(req, res);
    sendJson(res, 200, getCapabilities());
    return true;
  }

  const handledDashboardApi = await handleDashboardApi(req, res, url);
  if (handledDashboardApi) return true;

  const handledAgentOpsApi = await handleAgentOpsRestApi(req, res, url, {
    config,
    sendJson,
    setCorsHeaders,
    readJsonBody,
    readRawBody
  });
  if (handledAgentOpsApi) return true;

  const handledWorkspaceAgentApi = await handleWorkspaceAgentRestApi(req, res, url);
  if (handledWorkspaceAgentApi) return true;

  const handledGitHubApi = await handleGitHubRestApi(req, res, url);
  if (handledGitHubApi) return true;

  const designRequestMatch = url.pathname.match(/^\/api\/design-requests\/([^/]+)$/);

  if (req.method === "GET" && designRequestMatch) {
    setCorsHeaders(req, res);
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
    setCorsHeaders(req, res);

    try {
      const body = await readJsonBody(req);
      const parsed = agentResultSchema.parse(body);

      await submitAgentResult(parsed);
      const forwardResult = await forwardAgentResultToBackend(config, parsed);

      writeAuditEvent({
        action: "ds_submit_agent_result",
        source: "rest",
        request_id: parsed.request_id,
        status: "success"
      });

      sendJson(res, 200, {
        ok: true,
        request_id: parsed.request_id,
        stored: true,
        forwarded_to_backend: forwardResult.forwarded,
        backend_status: forwardResult.status
      });
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
  trackUpstreamCall(req, url);

  const securityContext = await enforceSecurity(req, res, url);
  if (!securityContext) return;

  if (req.method === "GET" && url.pathname === "/") {
    return sendJson(res, 200, getCapabilities(), { "X-Request-Id": securityContext.requestId });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true }, { "X-Request-Id": securityContext.requestId });
  }

  if (req.method === "GET" && url.pathname === "/dashboard/upstream-calls") {
    return sendHtml(res, 200, renderUpstreamDashboardHtml(), { "X-Request-Id": securityContext.requestId });
  }

  const handledAdminStatic = await handleAdminStatic(req, res, url);
  if (handledAdminStatic) return;

  const handledWorkspaceAgentCallback = await handleWorkspaceAgentCallback(req, res, url);
  if (handledWorkspaceAgentCallback) return;

  const handledRestApi = await handleRestApi(req, res, url);
  if (handledRestApi) return;

  if (!isMcpRequestPath(config.mcpPath, url.pathname)) {
    return sendJson(res, 404, { error: "Not found", request_id: securityContext.requestId }, { "X-Request-Id": securityContext.requestId });
  }

  if (!req.method || !["POST", "GET", "DELETE"].includes(req.method)) {
    return sendJson(res, 405, { error: "Method not allowed", request_id: securityContext.requestId }, { "X-Request-Id": securityContext.requestId });
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
