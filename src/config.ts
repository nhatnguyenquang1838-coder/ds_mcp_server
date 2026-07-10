export type RuntimeMode = "local" | "development" | "staging" | "production";
export type SecurityEnforcement = "relaxed" | "strict";

export type DatabaseProfile = {
  target: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
};

export type AppConfig = {
  port: number;
  mcpPath: string;
  mcpBearerToken?: string;
  mcpUrlSecret?: string;
  restApiBearerToken?: string;
  designSystemBackendUrl?: string;
  internalAgentResultToken?: string;
  githubToken?: string;
  githubWebhookSecret?: string;
  githubAllowedRepos: string[];
  githubDefaultBaseBranch: string;
  githubAllowedBranchPrefixes: string[];
  githubMaxFileBytes: number;
  dsUploadSessionTtlSeconds: number;
  dsUploadChunkMaxBytes: number;
  dsUploadMaxFileBytes: number;
  dsUploadStorage: string;
  workspaceAgentTriggerId?: string;
  workspaceAgentToken?: string;
  workspaceAgentCallbackToken?: string;
  workspaceAgentApiBaseUrl: string;
  publicBaseUrl?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  runtimeMode: RuntimeMode;
  securityEnforcement: SecurityEnforcement;
  corsAllowedOrigins: string[];
  maxJsonBodyBytes: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  activeDbTarget: string;
  devToolsEnabled: boolean;
  devToolsAllowRealDbSwitch: boolean;
  databaseProfiles: Record<string, DatabaseProfile>;
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

function readBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readSecurityEnforcement(value: string | undefined): SecurityEnforcement {
  const fallback: SecurityEnforcement = process.env.NODE_ENV === "production" ? "strict" : "relaxed";
  if (!value) return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === "relaxed" || normalized === "strict") {
    return normalized;
  }

  throw new Error(`Invalid SECURITY_ENFORCEMENT: ${value}`);
}

function readOrigins(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        throw new Error(`Invalid CORS_ALLOWED_ORIGINS entry: ${origin}`);
      }
    });
}

function readRuntimeMode(value: string | undefined): RuntimeMode {
  const fallback: RuntimeMode = process.env.NODE_ENV === "production" ? "production" : "local";
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["local", "development", "staging", "production"].includes(normalized)) {
    return normalized as RuntimeMode;
  }
  throw new Error(`Invalid APP_RUNTIME_MODE: ${value}`);
}

function databaseProfile(
  target: string,
  supabaseUrl: string | undefined,
  supabaseServiceRoleKey: string | undefined
): DatabaseProfile {
  return {
    target,
    supabaseUrl: supabaseUrl || undefined,
    supabaseServiceRoleKey: supabaseServiceRoleKey || undefined
  };
}

function createDatabaseProfiles(): Record<string, DatabaseProfile> {
  return {
    default: databaseProfile("default", process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY),
    real: databaseProfile(
      "real",
      process.env.SUPABASE_REAL_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_REAL_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
    local: databaseProfile(
      "local",
      process.env.SUPABASE_LOCAL_URL,
      process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY
    ),
    development: databaseProfile(
      "development",
      process.env.SUPABASE_DEVELOPMENT_URL,
      process.env.SUPABASE_DEVELOPMENT_SERVICE_ROLE_KEY
    ),
    staging: databaseProfile(
      "staging",
      process.env.SUPABASE_STAGING_URL,
      process.env.SUPABASE_STAGING_SERVICE_ROLE_KEY
    ),
    production: databaseProfile(
      "production",
      process.env.SUPABASE_PRODUCTION_URL,
      process.env.SUPABASE_PRODUCTION_SERVICE_ROLE_KEY
    )
  };
}

function activeDatabaseProfile(
  profiles: Record<string, DatabaseProfile>,
  activeDbTarget: string
): DatabaseProfile {
  return profiles[activeDbTarget] ?? profiles.default ?? databaseProfile("default", undefined, undefined);
}

export function loadConfig(): AppConfig {
  const databaseProfiles = createDatabaseProfiles();
  const activeDbTarget = process.env.SUPABASE_ACTIVE_DB_TARGET || process.env.DB_TARGET || "default";
  const activeProfile = activeDatabaseProfile(databaseProfiles, activeDbTarget);
  const securityEnforcement = readSecurityEnforcement(process.env.SECURITY_ENFORCEMENT);
  const corsAllowedOrigins = readOrigins(process.env.CORS_ALLOWED_ORIGINS);

  return {
    port: readPort(process.env.PORT),
    mcpPath: process.env.MCP_PATH || "/mcp",
    mcpBearerToken: process.env.MCP_BEARER_TOKEN || undefined,
    mcpUrlSecret: process.env.MCP_URL_SECRET || undefined,
    restApiBearerToken: process.env.REST_API_BEARER_TOKEN || undefined,
    designSystemBackendUrl: process.env.DS_BACKEND_URL || undefined,
    internalAgentResultToken: process.env.INTERNAL_AGENT_RESULT_TOKEN || undefined,
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || undefined,
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
    dsUploadSessionTtlSeconds: readPositiveInteger(process.env.DS_UPLOAD_SESSION_TTL_SECONDS, 3600),
    dsUploadChunkMaxBytes: readPositiveInteger(process.env.DS_UPLOAD_CHUNK_MAX_BYTES, 1_048_576),
    dsUploadMaxFileBytes: readPositiveInteger(process.env.DS_UPLOAD_MAX_FILE_BYTES, 10_485_760),
    dsUploadStorage: process.env.DS_UPLOAD_STORAGE || "memory",
    workspaceAgentTriggerId: process.env.WORKSPACE_AGENT_TRIGGER_ID || undefined,
    workspaceAgentToken: process.env.WORKSPACE_AGENT_TOKEN || undefined,
    workspaceAgentCallbackToken: process.env.WORKSPACE_AGENT_CALLBACK_TOKEN || undefined,
    workspaceAgentApiBaseUrl:
      process.env.WORKSPACE_AGENT_API_BASE_URL || "https://api.chatgpt.com",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || undefined,
    supabaseUrl: activeProfile.supabaseUrl,
    supabaseServiceRoleKey: activeProfile.supabaseServiceRoleKey,
    runtimeMode: readRuntimeMode(process.env.APP_RUNTIME_MODE),
    securityEnforcement,
    corsAllowedOrigins,
    maxJsonBodyBytes: readPositiveInteger(process.env.MAX_JSON_BODY_BYTES, 1_048_576),
    rateLimitWindowMs: readPositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMaxRequests: readPositiveInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 120),
    activeDbTarget,
    devToolsEnabled: readBoolean(process.env.DEV_TOOLS_ENABLED),
    devToolsAllowRealDbSwitch: readBoolean(process.env.DEV_TOOLS_ALLOW_REAL_DB_SWITCH),
    databaseProfiles
  };
}
