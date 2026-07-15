import type { AppConfig } from "../config.js";
import { getSupabaseClient, isSupabaseConfigured } from "../db/supabaseClient.js";
import { buildRateLimitRpcArgs } from "./rateLimit.js";
import { redactValue } from "./redaction.js";

export type SecurityStartupSummary = {
  enforcement: AppConfig["securityEnforcement"];
  runtimeMode: AppConfig["runtimeMode"];
  restBearerConfigured: boolean;
  mcpBearerConfigured: boolean;
  mcpUrlSecretConfigured: boolean;
  mcpOAuthConfigured: boolean;
  webhookSecretConfigured: boolean;
  internalCallbackConfigured: boolean;
  supabaseConfigured: boolean;
  corsAllowedOrigins: number;
  maxJsonBodyBytes: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
};

function addIssue(issues: string[], condition: boolean, message: string): void {
  if (!condition) issues.push(message);
}

export function summarizeSecurityConfig(config: AppConfig): SecurityStartupSummary {
  return {
    enforcement: config.securityEnforcement,
    runtimeMode: config.runtimeMode,
    restBearerConfigured: Boolean(config.restApiBearerToken),
    mcpBearerConfigured: Boolean(config.mcpBearerToken),
    mcpUrlSecretConfigured: Boolean(config.mcpUrlSecret),
    mcpOAuthConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
    webhookSecretConfigured: Boolean(config.githubWebhookSecret),
    internalCallbackConfigured: Boolean(config.workspaceAgentCallbackToken),
    supabaseConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
    corsAllowedOrigins: config.corsAllowedOrigins.length,
    maxJsonBodyBytes: config.maxJsonBodyBytes,
    rateLimitWindowMs: config.rateLimitWindowMs,
    rateLimitMaxRequests: config.rateLimitMaxRequests
  };
}

export function validateSecurityStartup(config: AppConfig): {
  ok: boolean;
  summary: SecurityStartupSummary;
  issues: string[];
} {
  const summary = summarizeSecurityConfig(config);
  const issues: string[] = [];

  if (config.securityEnforcement === "strict") {
    addIssue(issues, Boolean(config.restApiBearerToken), "REST_API_BEARER_TOKEN is required");
    addIssue(
      issues,
      Boolean(config.mcpBearerToken || config.mcpUrlSecret || summary.mcpOAuthConfigured),
      "MCP_BEARER_TOKEN, MCP_URL_SECRET, or OAuth configuration is required"
    );
    addIssue(issues, summary.supabaseConfigured, "Supabase configuration is required");
  }

  return {
    ok: issues.length === 0,
    summary: redactValue(summary),
    issues: redactValue(issues)
  };
}

export async function validateSecurityRuntimeDependencies(config: AppConfig): Promise<{
  ok: boolean;
  issues: string[];
}> {
  if (config.runtimeMode === "local" || config.securityEnforcement !== "strict" || !isSupabaseConfigured(config)) {
    return { ok: true, issues: [] };
  }

  const issues: string[] = [];
  const supabase = getSupabaseClient(config);

  const { error: oauthError } = await supabase
    .from("mcp_oauth_clients")
    .select("client_id")
    .limit(1);

  if (oauthError) {
    issues.push(`OAuth persistence check failed: ${oauthError.message}`);
  }

  const { error: rateLimitError } = await supabase.rpc(
    "security_rate_limit_acquire",
    buildRateLimitRpcArgs("__startup_probe__", 60_000, 1)
  );

  if (rateLimitError) {
    issues.push(`Rate limit RPC check failed: ${rateLimitError.message}`);
  }

  return {
    ok: issues.length === 0,
    issues: redactValue(issues)
  };
}

export function formatSecurityStartupError(issues: string[], summary: SecurityStartupSummary): string {
  return `Security startup validation failed: ${issues.join("; ")} | summary=${JSON.stringify(redactValue(summary))}`;
}

export function formatSecurityRuntimeStartupError(issues: string[]): string {
  return `Security runtime dependency validation failed: ${redactValue(issues).join("; ")}`;
}
