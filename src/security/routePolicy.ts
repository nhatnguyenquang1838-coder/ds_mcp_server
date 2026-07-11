export type RouteAuthPolicy =
  | "public"
  | "rest_bearer"
  | "mcp_bearer"
  | "internal_token"
  | "webhook_signature"
  | "disabled";

export type ResolvedRoutePolicy = {
  routeId: string;
  policy: RouteAuthPolicy;
  sensitive: boolean;
};

export type ResolvedRateLimitPolicy = {
  windowMs: number;
  maxRequests: number;
  label: string;
};

function isAdminAsset(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard/upstream-calls" || pathname.startsWith("/api/dashboard/");
}

function isAgentOpsPath(pathname: string): boolean {
  return (
    pathname === "/api/tasks" ||
    pathname.startsWith("/api/tasks/") ||
    pathname.startsWith("/api/task-links/") ||
    pathname === "/api/workflows" ||
    pathname.startsWith("/api/workflows/") ||
    pathname === "/api/async-tasks/claim" ||
    pathname.startsWith("/api/async-tasks/") ||
    pathname === "/api/agents" ||
    pathname === "/api/agents/health" ||
    pathname === "/api/agents/register" ||
    pathname.startsWith("/api/agents/") ||
    pathname === "/api/scheduler/tick" ||
    pathname === "/api/scheduler/runs" ||
    pathname === "/api/scheduler/cron-schedules" ||
    pathname === "/api/scheduler/retry-policies" ||
    pathname === "/api/dev/environment" ||
    pathname.startsWith("/api/webhooks/")
  );
}

function isGitHubGatewayPath(pathname: string): boolean {
  return pathname.startsWith("/api/github/");
}

function isGitHubWebhook(pathname: string): boolean {
  return pathname === "/api/webhooks/github";
}

function isOAuthPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/openid-configuration" ||
    pathname === "/oauth/register" ||
    pathname === "/oauth/authorize" ||
    pathname === "/oauth/token" ||
    pathname === "/oauth/revoke"
  );
}

export function resolveRateLimitPolicy(method: string, pathname: string): ResolvedRateLimitPolicy | undefined {
  const normalizedMethod = method.toUpperCase();

  if (isOAuthPath(pathname)) {
    return { windowMs: 10 * 60_000, maxRequests: 10, label: "oauth" };
  }

  if (pathname === "/api/security/posture") {
    return { windowMs: 60_000, maxRequests: 60, label: "security-admin" };
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return { windowMs: 60_000, maxRequests: 60, label: "security-admin" };
  }

  if (pathname === "/dashboard/upstream-calls" || pathname.startsWith("/api/dashboard/")) {
    return { windowMs: 60_000, maxRequests: 120, label: "dashboard-read" };
  }

  if (pathname.startsWith("/api/upload")) {
    return { windowMs: 60_000, maxRequests: 5, label: "upload-write" };
  }

  if (pathname.startsWith("/api/github/") && normalizedMethod === "POST") {
    return { windowMs: 60_000, maxRequests: 10, label: "github-write" };
  }

  if (
    (pathname === "/api/tasks" && normalizedMethod === "POST") ||
    (pathname.startsWith("/api/tasks/") && ["POST", "PATCH", "DELETE"].includes(normalizedMethod)) ||
    (pathname.startsWith("/api/task-links/") && ["POST", "DELETE"].includes(normalizedMethod)) ||
    (pathname === "/api/workflows" && normalizedMethod === "POST") ||
    (pathname.startsWith("/api/workflows/") && normalizedMethod === "POST") ||
    pathname === "/api/agent-results" ||
    pathname === "/api/agent-runs" ||
    pathname.startsWith("/api/agent-runs/")
  ) {
    return { windowMs: 60_000, maxRequests: 30, label: "task-write" };
  }

  if (pathname.startsWith("/internal/agent-runs")) {
    return { windowMs: 60_000, maxRequests: 30, label: "internal-callback" };
  }

  return undefined;
}

export function resolveRoutePolicy(method: string, pathname: string): ResolvedRoutePolicy {
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod === "GET" && pathname === "/health") {
    return { routeId: "public.health", policy: "public", sensitive: false };
  }

  if (normalizedMethod === "GET" && pathname === "/") {
    return { routeId: "public.capabilities-root", policy: "public", sensitive: false };
  }

  if (normalizedMethod === "GET" && pathname === "/api/capabilities") {
    return { routeId: "public.capabilities", policy: "public", sensitive: false };
  }

  if (normalizedMethod === "GET" && pathname === "/api/diagnostics/url-map") {
    return { routeId: "public.url-diagnostics", policy: "public", sensitive: false };
  }

  if (isGitHubWebhook(pathname)) {
    return { routeId: "webhook.github", policy: "webhook_signature", sensitive: true };
  }

  if (isOAuthPath(pathname)) {
    return { routeId: `oauth.${pathname.replace(/^\//, "").replace(/\//g, ".")}`, policy: "public", sensitive: false };
  }

  if (pathname === "/mcp") {
    return { routeId: "mcp.streamable", policy: "mcp_bearer", sensitive: true };
  }

  if (pathname.startsWith("/mcp/")) {
    return { routeId: "mcp.connector_secret", policy: "disabled", sensitive: true };
  }

  if (/^\/internal\/agent-runs\/[^/]+\/result$/.test(pathname)) {
    return { routeId: "internal.agent_run_result", policy: "internal_token", sensitive: true };
  }

  if (pathname === "/internal/agent-runs" || pathname.startsWith("/internal/agent-runs/")) {
    return { routeId: "internal.agent_runs", policy: "internal_token", sensitive: true };
  }

  if (isDashboardPath(pathname)) {
    return { routeId: "dashboard.operational", policy: "rest_bearer", sensitive: true };
  }

  if (pathname === "/api/security/posture") {
    return { routeId: "security.posture", policy: "rest_bearer", sensitive: true };
  }

  if (isAdminAsset(pathname)) {
    return { routeId: "admin.static", policy: "rest_bearer", sensitive: true };
  }

  if (isGitHubGatewayPath(pathname)) {
    return { routeId: "github.gateway", policy: "rest_bearer", sensitive: true };
  }

  if (
    pathname === "/api/design-requests" ||
    pathname.startsWith("/api/design-requests/") ||
    pathname === "/api/agent-results" ||
    pathname === "/api/agent-runs" ||
    pathname.startsWith("/api/agent-runs/") ||
    pathname === "/api/tasks" ||
    pathname.startsWith("/api/tasks/") ||
    pathname.startsWith("/api/task-links/") ||
    pathname === "/api/workflows" ||
    pathname.startsWith("/api/workflows/") ||
    pathname === "/api/async-tasks/claim" ||
    pathname.startsWith("/api/async-tasks/") ||
    pathname === "/api/agents" ||
    pathname === "/api/agents/health" ||
    pathname === "/api/agents/register" ||
    pathname.startsWith("/api/agents/") ||
    pathname === "/api/scheduler/tick" ||
    pathname === "/api/scheduler/runs" ||
    pathname === "/api/scheduler/cron-schedules" ||
    pathname === "/api/scheduler/retry-policies" ||
    pathname === "/api/dev/environment" ||
    pathname === "/api/github" ||
    pathname.startsWith("/api/github/") ||
    pathname.startsWith("/api/upload") ||
    pathname.startsWith("/api/dashboard/") ||
    pathname === "/api/webhooks/github"
  ) {
    return {
      routeId: "rest.sensitive",
      policy: pathname === "/api/webhooks/github" ? "webhook_signature" : "rest_bearer",
      sensitive: true
    };
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/internal/")) {
    return { routeId: "unknown.sensitive", policy: "disabled", sensitive: true };
  }

  return { routeId: "public.unknown", policy: "public", sensitive: false };
}
