export type AppConfig = {
  port: number;
  mcpPath: string;
  mcpBearerToken?: string;
  designSystemBackendUrl?: string;
  internalAgentResultToken?: string;
  githubToken?: string;
  githubAllowedRepos: string[];
  githubDefaultBaseBranch: string;
  githubAllowedBranchPrefixes: string[];
};

function readPort(value: string | undefined): number {
  if (!value) return 8787;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return parsed;
}

function readCsv(value: string | undefined, fallback: string[] = []): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  return {
    port: readPort(process.env.PORT),
    mcpPath: process.env.MCP_PATH || "/mcp",
    mcpBearerToken: process.env.MCP_BEARER_TOKEN || undefined,
    designSystemBackendUrl: process.env.DS_BACKEND_URL || undefined,
    internalAgentResultToken: process.env.INTERNAL_AGENT_RESULT_TOKEN || undefined,
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubAllowedRepos: readCsv(process.env.GITHUB_ALLOWED_REPOS),
    githubDefaultBaseBranch: process.env.GITHUB_DEFAULT_BASE_BRANCH || "main",
    githubAllowedBranchPrefixes: readCsv(process.env.GITHUB_ALLOWED_BRANCH_PREFIXES, [
      "feature/",
      "fix/",
      "chore/",
      "docs/",
      "ai/"
    ])
  };
}
