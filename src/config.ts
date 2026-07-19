import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type RuntimeMode = "local" | "development" | "staging" | "production";
export type SecurityEnforcement = "relaxed" | "strict";

export const DEFAULT_CORS_ALLOWED_ORIGINS = ["https://chatgpt.com", "https://chat.openai.com"];

function parseEnvFile(contents: string): Record<string, string> {
  const output: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = assignment.slice(0, equalsIndex).trim();
    let value = assignment.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      output[key] = value;
    }
  }

  return output;
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function loadLocalEnvFiles(): void {
  const cwd = resolve(process.cwd());
  loadEnvFile(resolve(cwd, ".env"));
  loadEnvFile(resolve(cwd, ".env.local"));
}

loadLocalEnvFiles();

function appEnv(name: string): string | undefined {
  const prefixed = process.env[`DS_MCP_${name}`];
  if (prefixed !== undefined && prefixed !== "") return prefixed;

  const legacy = process.env[name];
  if (legacy !== undefined && legacy !== "") return legacy;

  return undefined;
}

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
  supabaseAnonKey?: string;
  supabaseOauthProvider: string;
  supabaseOauthScopes: string[];
  adminAllowedEmails: string[];
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
  runtimeEnabled: boolean;
  writeEnabled: boolean;
  runtimeId: string;
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
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readRuntimeId(): string {
  return (
    appEnv("RUNTIME_ID") ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.HOSTNAME ||
    "local"
  );
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
  if (!value) return DEFAULT_CORS_ALLOWED_ORIGINS;

  const raw = value
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

  // Deduplicate while preserving order.
  const unique = [...new Set(raw)];

  if (unique.length > 0) {
    console.log(`[config] CORS allowed origins (${unique.length}):`, unique.join(", "));
  }

  return unique;
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
    default: databaseProfile("default", appEnv("SUPABASE_URL"), appEnv("SUPABASE_SERVICE_ROLE_KEY")),
    real: databaseProfile(
      "real",
      appEnv("SUPABASE_REAL_URL") || appEnv("SUPABASE_URL"),
      appEnv("SUPABASE_REAL_SERVICE_ROLE_KEY") || appEnv("SUPABASE_SERVICE_ROLE_KEY")
    ),
    local: databaseProfile(
      "local",
      appEnv("SUPABASE_LOCAL_URL"),
      appEnv("SUPABASE_LOCAL_SERVICE_ROLE_KEY")
    ),
    development: databaseProfile(
      "development",
      appEnv("SUPABASE_DEVELOPMENT_URL"),
      appEnv("SUPABASE_DEVELOPMENT_SERVICE_ROLE_KEY")
    ),
    staging: databaseProfile(
      "staging",
      appEnv("SUPABASE_STAGING_URL"),
      appEnv("SUPABASE_STAGING_SERVICE_ROLE_KEY")
    ),
    production: databaseProfile(
      "production",
      appEnv("SUPABASE_PRODUCTION_URL"),
      appEnv("SUPABASE_PRODUCTION_SERVICE_ROLE_KEY")
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
  const activeDbTarget = appEnv("SUPABASE_ACTIVE_DB_TARGET") || appEnv("DB_TARGET") || "default";
  const activeProfile = activeDatabaseProfile(databaseProfiles, activeDbTarget);
  const securityEnforcement = readSecurityEnforcement(appEnv("SECURITY_ENFORCEMENT"));
  const corsAllowedOrigins = readOrigins(appEnv("CORS_ALLOWED_ORIGINS"));
  const vercelUrl = process.env.VERCEL_URL?.trim();

  return {
    port: readPort(appEnv("PORT")),
    mcpPath: appEnv("MCP_PATH") || "/mcp",
    mcpBearerToken: appEnv("MCP_BEARER_TOKEN") || undefined,
    mcpUrlSecret: appEnv("MCP_URL_SECRET") || undefined,
    restApiBearerToken: appEnv("REST_API_BEARER_TOKEN") || undefined,
    designSystemBackendUrl: appEnv("DS_BACKEND_URL") || undefined,
    internalAgentResultToken: appEnv("INTERNAL_AGENT_RESULT_TOKEN") || undefined,
    githubToken: appEnv("GITHUB_TOKEN") || undefined,
    githubWebhookSecret: appEnv("GITHUB_WEBHOOK_SECRET") || undefined,
    githubAllowedRepos: readCsv(appEnv("GITHUB_ALLOWED_REPOS")),
    githubDefaultBaseBranch: appEnv("GITHUB_DEFAULT_BASE_BRANCH") || "main",
    githubAllowedBranchPrefixes: readCsv(appEnv("GITHUB_ALLOWED_BRANCH_PREFIXES"), [
      "feature/",
      "fix/",
      "chore/",
      "docs/",
      "ai/"
    ]),
    githubMaxFileBytes: readPositiveInteger(appEnv("GITHUB_MAX_FILE_BYTES"), 1_048_576),
    dsUploadSessionTtlSeconds: readPositiveInteger(appEnv("DS_UPLOAD_SESSION_TTL_SECONDS"), 3600),
    dsUploadChunkMaxBytes: readPositiveInteger(appEnv("DS_UPLOAD_CHUNK_MAX_BYTES"), 1_048_576),
    dsUploadMaxFileBytes: readPositiveInteger(appEnv("DS_UPLOAD_MAX_FILE_BYTES"), 10_485_760),
    dsUploadStorage: appEnv("DS_UPLOAD_STORAGE") || "memory",
    workspaceAgentTriggerId: appEnv("WORKSPACE_AGENT_TRIGGER_ID") || undefined,
    workspaceAgentToken: appEnv("WORKSPACE_AGENT_TOKEN") || undefined,
    workspaceAgentCallbackToken: appEnv("WORKSPACE_AGENT_CALLBACK_TOKEN") || undefined,
    workspaceAgentApiBaseUrl:
      appEnv("WORKSPACE_AGENT_API_BASE_URL") || "https://api.chatgpt.com",
    publicBaseUrl: appEnv("PUBLIC_BASE_URL") || (vercelUrl ? `https://${vercelUrl}` : undefined),
    supabaseUrl: activeProfile.supabaseUrl,
    supabaseServiceRoleKey: activeProfile.supabaseServiceRoleKey,
    supabaseAnonKey: appEnv("SUPABASE_ANON_KEY") || undefined,
    supabaseOauthProvider: appEnv("SUPABASE_OAUTH_PROVIDER") || "google",
    supabaseOauthScopes: readCsv(appEnv("SUPABASE_OAUTH_SCOPES"), ["openid", "email", "profile"]),
    adminAllowedEmails: readCsv(appEnv("SUPABASE_ADMIN_ALLOWED_EMAILS")),
    runtimeMode: readRuntimeMode(appEnv("APP_RUNTIME_MODE")),
    securityEnforcement,
    corsAllowedOrigins,
    maxJsonBodyBytes: readPositiveInteger(appEnv("MAX_JSON_BODY_BYTES"), 1_048_576),
    rateLimitWindowMs: readPositiveInteger(appEnv("RATE_LIMIT_WINDOW_MS"), 60_000),
    rateLimitMaxRequests: readPositiveInteger(appEnv("RATE_LIMIT_MAX_REQUESTS"), 120),
    activeDbTarget,
    devToolsEnabled: readBoolean(appEnv("DEV_TOOLS_ENABLED")),
    devToolsAllowRealDbSwitch: readBoolean(appEnv("DEV_TOOLS_ALLOW_REAL_DB_SWITCH")),
    databaseProfiles,
    runtimeEnabled: readBoolean(appEnv("RUNTIME_ENABLED"), true),
    writeEnabled: readBoolean(appEnv("WRITE_ENABLED"), true),
    runtimeId: readRuntimeId()
  };
}
