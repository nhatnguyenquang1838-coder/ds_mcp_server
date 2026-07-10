import type { AppConfig } from "../config.js";
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

export function formatSecurityStartupError(issues: string[], summary: SecurityStartupSummary): string {
  return `Security startup validation failed: ${issues.join("; ")} | summary=${JSON.stringify(redactValue(summary))}`;
}
