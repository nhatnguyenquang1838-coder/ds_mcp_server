const DEFAULT_PUBLIC_BASE_URL = "https://ds-mcp-server-one.vercel.app";

export type UrlDiagnosticsResponse = {
  ok: true;
  service: "ds-mcp-server";
  environment: string;
  baseUrl: string;
  routes: {
    health: "/health";
    mcp: string;
    capabilities: "/api/capabilities";
    diagnostics: "/api/diagnostics/url-map";
    githubRepo: "/api/github/repos/{owner}/{repo}";
    githubFile: "/api/github/repos/{owner}/{repo}/files";
    branch: "/api/github/repos/{owner}/{repo}/branches";
    pullRequest: "/api/github/repos/{owner}/{repo}/pull-requests";
    workflowRuns: "/api/github/repos/{owner}/{repo}/workflow-runs";
    githubWebhook: "/api/webhooks/github";
  };
};

export function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl?.trim() || DEFAULT_PUBLIC_BASE_URL).replace(/\/$/, "");
}

export function getUrlDiagnostics(input: {
  baseUrl?: string;
  environment?: string;
  mcpPath?: string;
} = {}): UrlDiagnosticsResponse {
  return {
    ok: true,
    service: "ds-mcp-server",
    environment: input.environment || "unknown",
    baseUrl: normalizeBaseUrl(input.baseUrl),
    routes: {
      health: "/health",
      mcp: input.mcpPath || "/mcp",
      capabilities: "/api/capabilities",
      diagnostics: "/api/diagnostics/url-map",
      githubRepo: "/api/github/repos/{owner}/{repo}",
      githubFile: "/api/github/repos/{owner}/{repo}/files",
      branch: "/api/github/repos/{owner}/{repo}/branches",
      pullRequest: "/api/github/repos/{owner}/{repo}/pull-requests",
      workflowRuns: "/api/github/repos/{owner}/{repo}/workflow-runs",
      githubWebhook: "/api/webhooks/github"
    }
  };
}
