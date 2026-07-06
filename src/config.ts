export type AppConfig = {
  port: number;
  mcpPath: string;
  mcpBearerToken?: string;
  restApiBearerToken?: string;
  designSystemBackendUrl?: string;
  internalAgentResultToken?: string;
  githubToken?: string;
  githubAllowedRepos: string[];
  githubDefaultBaseBranch: string;
  githubAllowedBranchPrefixes: string[];
  githubMaxFileBytes: number;
  workspaceAgentTriggerId?: string;
  workspaceAgentToken?: string;
  workspaceAgentCallbackToken?: string;
  workspaceAgentApiBaseUrl: string;
  publicBaseUrl?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
};

function readPort(value: string | undefined): number {
  if (!value) return 8787;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return parsed;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
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
    restApiBearerToken: process.env.REST_API_BEARER_TOKEN || undefined,
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
    ]),
    githubMaxFileBytes: readPositiveInteger(process.env.GITHUB_MAX_FILE_BYTES, 1_048_576),
    workspaceAgentTriggerId: process.env.WORKSPACE_AGENT_TRIGGER_ID || undefined,
    workspaceAgentToken: process.env.WORKSPACE_AGENT_TOKEN || undefined,
    workspaceAgentCallbackToken: process.env.WORKSPACE_AGENT_CALLBACK_TOKEN || undefined,
    workspaceAgentApiBaseUrl:
      process.env.WORKSPACE_AGENT_API_BASE_URL || "https://api.chatgpt.com",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || undefined,
    supabaseUrl: process.env.SUPABASE_URL || undefined,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined
  };
}
