import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";

export const DS_MCP_SERVICE_ID = "ds-mcp-server-one";

type CapabilityTransport = "mcp" | "rest" | "internal";
type RequiredGate = "G2_EXECUTION" | "G3_PR" | "G4_MERGE" | "G5_DEPLOY" | "G6_PRODUCTION_DATA" | null;
type CapabilityErrorCode =
  | "PLUGIN_DISABLED"
  | "TOOL_REGISTRY_DRIFT"
  | "WRITE_DISABLED"
  | "AUTH_NOT_CONFIGURED"
  | "METHOD_NOT_AVAILABLE"
  | "DEGRADED_READ_ONLY";

type CapabilityDefinition = {
  name: string;
  transport: CapabilityTransport;
  read_only: boolean;
  write_capable: boolean;
  required_gate: RequiredGate;
  requires_auth: boolean;
};

export type DsMcpCapability = CapabilityDefinition & {
  enabled: boolean;
  runtime_available: boolean;
  disabled_reason?: string;
};

export type DsMcpReadiness = {
  ok: true;
  enabled: boolean;
  authenticated: boolean;
  write_enabled: boolean;
  service: string;
  runtime_id: string;
  schema_version: string;
  capabilities_version: string;
  startup_validated: boolean;
  degraded_mode?: "read_only";
};

export type DsMcpStructuredError = {
  ok: false;
  error: {
    code: CapabilityErrorCode;
    service: string;
    retryable: false;
    details: string;
    method?: string;
    request_id?: string;
  };
};

export type CapabilityStartupEvaluation = {
  ok: boolean;
  startup_validated: boolean;
  degraded_mode: boolean;
  exposed_tool_names: string[];
  runtime_capability_names: string[];
  enabled_runtime_tool_names: string[];
  issues: DsMcpStructuredError[];
};

const READ_ONLY_REST_PATHS = [
  "/api/capabilities",
  "/api/diagnostics/url-map",
  "/api/security/posture",
  "/api/dashboard/upstream-calls",
  "/dashboard/upstream-calls",
  "/api/tasks",
  "/api/tasks/{task_id}",
  "/api/tasks/{task_id}/links",
  "/api/tasks/{task_id}/events",
  "/api/workflows/{workflow_id}",
  "/api/design-requests/{request_id}",
  "/api/github/repos/{owner}/{repo}",
  "/api/github/repos/{owner}/{repo}/files",
  "/api/github/repos/{owner}/{repo}/tree",
  "/api/github/repos/{owner}/{repo}/binary-file",
  "/api/github/repos/{owner}/{repo}/integrity-artifacts",
  "/api/github/repos/{owner}/{repo}/workflow-runs",
  "/api/github/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
  "/api/github/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip",
  "/api/github/repos/{owner}/{repo}/archive",
  "/api/github/repos/{owner}/{repo}/upload-sessions/{session_id}"
];

export const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  { name: "ds_ping", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "get_capabilities", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "ds_get_request", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "ds_submit_agent_result", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "github_get_repo", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_read_file", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_list_tree", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_read_binary_file", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_generate_integrity_artifacts", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_create_branch", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "github_upsert_file", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "github_push_file", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "github_replace_in_file", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "github_create_pr", transport: "mcp", read_only: false, write_capable: true, required_gate: "G3_PR", requires_auth: true },
  { name: "github_mark_pr_ready_for_review", transport: "mcp", read_only: false, write_capable: true, required_gate: "G3_PR", requires_auth: true },
  { name: "github_merge_pr", transport: "mcp", read_only: false, write_capable: true, required_gate: "G4_MERGE", requires_auth: true },
  { name: "github_get_workflow_runs", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_list_workflow_run_artifacts", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_download_workflow_artifact_zip", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_download_repo_archive_zip", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "github_comment_pr", transport: "mcp", read_only: false, write_capable: true, required_gate: "G3_PR", requires_auth: true },
  { name: "task_state_contract_get", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "task_list", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "task_get", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "task_create", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "task_update", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "task_transition", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "task_links_list", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "task_link_create", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "task_events_list", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "async_workflow_create", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "async_workflow_get", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "async_task_claim", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "async_task_submit_result", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "github_ci_event_handle", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "agent_list", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "agent_health", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "agent_register", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "agent_heartbeat", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "scheduler_tick", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "scheduler_runs_list", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "cron_schedules_list", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "cron_schedule_upsert", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "retry_policies_list", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true },
  { name: "retry_policy_upsert", transport: "mcp", read_only: false, write_capable: true, required_gate: "G2_EXECUTION", requires_auth: true },
  { name: "dashboard_snapshot", transport: "mcp", read_only: true, write_capable: false, required_gate: null, requires_auth: true }
];

export const MCP_TOOL_NAMES = CAPABILITY_DEFINITIONS
  .filter((definition) => definition.transport === "mcp")
  .map((definition) => definition.name);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function schemaVersion(): string {
  return sha256({ service: DS_MCP_SERVICE_ID, contract: "readiness-capability-v1" });
}

export function capabilitiesVersion(): string {
  return sha256(CAPABILITY_DEFINITIONS);
}

export function isAuthSatisfied(config: AppConfig): boolean {
  if (config.securityEnforcement === "relaxed" && config.runtimeMode !== "production") return true;
  return Boolean(
    config.mcpBearerToken ||
      config.mcpUrlSecret ||
      config.restApiBearerToken ||
      (config.supabaseUrl && config.supabaseServiceRoleKey)
  );
}

function capabilityByName(name: string): CapabilityDefinition | undefined {
  return CAPABILITY_DEFINITIONS.find((definition) => definition.name === name);
}

export function isWriteCapability(name: string): boolean {
  return capabilityByName(name)?.write_capable === true;
}

function disabledReason(config: AppConfig, capability: CapabilityDefinition, startupValidated: boolean): string | undefined {
  if (!config.runtimeEnabled) return "The plugin is registered but disabled in the current runtime.";
  if (!startupValidated) return "The service startup validation has not passed.";
  if (capability.requires_auth && !isAuthSatisfied(config)) return "Authentication is not configured for this runtime.";
  if (capability.write_capable && !config.writeEnabled) return "Runtime is in degraded read-only mode.";
  return undefined;
}

export function buildDsReadiness(config: AppConfig, startupValidated = true): DsMcpReadiness {
  const authenticated = isAuthSatisfied(config);
  const writeEnabled = Boolean(config.runtimeEnabled && config.writeEnabled && authenticated && startupValidated);
  return {
    ok: true,
    enabled: config.runtimeEnabled,
    authenticated,
    write_enabled: writeEnabled,
    service: DS_MCP_SERVICE_ID,
    runtime_id: config.runtimeId,
    schema_version: schemaVersion(),
    capabilities_version: capabilitiesVersion(),
    startup_validated: startupValidated,
    ...(config.runtimeEnabled && !writeEnabled ? { degraded_mode: "read_only" as const } : {})
  };
}

export function buildDsPingResponse(config: AppConfig, startupValidated = true): DsMcpReadiness {
  return buildDsReadiness(config, startupValidated);
}

export function getRuntimeCapabilities(config: AppConfig, startupValidated = true): DsMcpCapability[] {
  return CAPABILITY_DEFINITIONS.map((capability) => {
    const reason = disabledReason(config, capability, startupValidated);
    return {
      ...capability,
      enabled: !reason,
      runtime_available: config.runtimeEnabled && startupValidated && !reason,
      ...(reason ? { disabled_reason: reason } : {})
    };
  });
}

export function shouldExposeCapability(config: AppConfig, name: string, startupValidated = true): boolean {
  const capability = capabilityByName(name);
  if (!capability) return false;
  if (!capability.write_capable) {
    if (name === "ds_ping" || name === "get_capabilities") return startupValidated;
    return config.runtimeEnabled && startupValidated;
  }
  return !disabledReason(config, capability, startupValidated);
}

export function structuredCapabilityError(
  code: CapabilityErrorCode,
  details: string,
  method?: string,
  requestId?: string
): DsMcpStructuredError {
  return {
    ok: false,
    error: {
      code,
      service: DS_MCP_SERVICE_ID,
      retryable: false,
      details,
      ...(method ? { method } : {}),
      ...(requestId ? { request_id: requestId } : {})
    }
  };
}

export function guardWriteCapability(
  config: AppConfig,
  method: string,
  requestId?: string,
  startupValidated = true
): DsMcpStructuredError | null {
  const capability = capabilityByName(method);
  if (!capability) {
    return structuredCapabilityError(
      "TOOL_REGISTRY_DRIFT",
      "The exposed tool schema does not match the active runtime capability registry.",
      method,
      requestId
    );
  }

  if (!capability.write_capable) return null;

  if (!config.runtimeEnabled) {
    return structuredCapabilityError(
      "PLUGIN_DISABLED",
      "The plugin is registered but disabled in the current runtime.",
      method,
      requestId
    );
  }

  if (!startupValidated) {
    return structuredCapabilityError(
      "METHOD_NOT_AVAILABLE",
      "The method is blocked because startup validation has not passed.",
      method,
      requestId
    );
  }

  if (capability.requires_auth && !isAuthSatisfied(config)) {
    return structuredCapabilityError(
      "AUTH_NOT_CONFIGURED",
      "Authentication is not configured for write-capable operations.",
      method,
      requestId
    );
  }

  if (!config.writeEnabled) {
    return structuredCapabilityError(
      "DEGRADED_READ_ONLY",
      "Runtime is in degraded read-only mode; write-capable methods are blocked before dispatch.",
      method,
      requestId
    );
  }

  return null;
}

export function mcpErrorResult(error: DsMcpStructuredError) {
  return {
    structuredContent: error,
    content: [{ type: "text" as const, text: JSON.stringify(error) }],
    isError: true
  };
}

export function installMcpReadinessGuard(server: unknown, config: AppConfig, startupValidated = true): void {
  const mutableServer = server as { registerTool: (...args: any[]) => any };
  const originalRegisterTool = mutableServer.registerTool.bind(mutableServer);

  mutableServer.registerTool = (name: string, toolConfig: unknown, callback: (...args: any[]) => unknown) => {
    if (!shouldExposeCapability(config, name, startupValidated)) {
      return {
        enable: () => undefined,
        disable: () => undefined,
        remove: () => undefined,
        update: () => undefined
      };
    }

    const guardedCallback = isWriteCapability(name)
      ? async (...args: any[]) => {
          const blocked = guardWriteCapability(config, name, undefined, startupValidated);
          if (blocked) return mcpErrorResult(blocked);
          return callback(...args);
        }
      : callback;

    return originalRegisterTool(name, toolConfig, guardedCallback);
  };
}

export function evaluateCapabilityRegistryDrift(
  config: AppConfig,
  exposedToolNames: string[] = MCP_TOOL_NAMES,
  startupValidated = true
): CapabilityStartupEvaluation {
  const runtimeCapabilityNames = CAPABILITY_DEFINITIONS.map((definition) => definition.name);
  const runtimeNameSet = new Set(runtimeCapabilityNames);
  const unknownExposed = exposedToolNames.filter((name) => !runtimeNameSet.has(name));
  const enabledRuntimeToolNames = getRuntimeCapabilities(config, startupValidated)
    .filter((capability) => capability.enabled)
    .map((capability) => capability.name);
  const issues = unknownExposed.map((method) =>
    structuredCapabilityError(
      "TOOL_REGISTRY_DRIFT",
      "The exposed tool schema does not match the active runtime capability registry.",
      method
    )
  );

  return {
    ok: issues.length === 0,
    startup_validated: startupValidated && issues.length === 0,
    degraded_mode: config.runtimeEnabled && !config.writeEnabled,
    exposed_tool_names: [...exposedToolNames].sort(),
    runtime_capability_names: runtimeCapabilityNames.sort(),
    enabled_runtime_tool_names: enabledRuntimeToolNames.sort(),
    issues
  };
}

export function formatCapabilityStartupError(evaluation: CapabilityStartupEvaluation): string {
  return `Capability startup validation failed: ${JSON.stringify(evaluation.issues)}`;
}

export function restWriteCapabilityName(method: string, pathname: string): string | null {
  const normalizedMethod = method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) return null;

  if (normalizedMethod === "POST" && pathname === "/api/agent-results") return "ds_submit_agent_result";
  if (normalizedMethod === "POST" && pathname === "/api/tasks") return "task_create";
  if (["PATCH", "PUT"].includes(normalizedMethod) && /^\/api\/tasks\/[^/]+$/.test(pathname)) return "task_update";
  if (normalizedMethod === "POST" && /^\/api\/tasks\/[^/]+\/transitions$/.test(pathname)) return "task_transition";
  if (normalizedMethod === "POST" && pathname === "/api/tasks/bulk/transitions") return "task_transition";
  if (normalizedMethod === "POST" && pathname === "/api/task-links") return "task_link_create";
  if (normalizedMethod === "POST" && /^\/api\/tasks\/[^/]+\/links$/.test(pathname)) return "task_link_create";
  if (normalizedMethod === "POST" && pathname === "/api/workflows") return "async_workflow_create";
  if (normalizedMethod === "POST" && /^\/internal\/agent-runs\/[^/]+\/result$/.test(pathname)) return "async_task_submit_result";
  if (normalizedMethod === "POST" && /^\/api\/github\/repos\/[^/]+\/[^/]+\/branches$/.test(pathname)) return "github_create_branch";
  if (normalizedMethod === "POST" && /^\/api\/github\/repos\/[^/]+\/[^/]+\/files$/.test(pathname)) return "github_upsert_file";
  if (normalizedMethod === "POST" && /^\/api\/github\/repos\/[^/]+\/[^/]+\/pull-requests$/.test(pathname)) return "github_create_pr";
  if (normalizedMethod === "POST" && /^\/api\/github\/repos\/[^/]+\/[^/]+\/pull-requests\/\d+\/comments$/.test(pathname)) return "github_comment_pr";
  if (/^\/api\/github\/repos\/[^/]+\/[^/]+\/upload-sessions/.test(pathname)) return "github_upsert_file";
  if (normalizedMethod === "POST" && pathname === "/api/webhooks/github") return "github_ci_event_handle";

  return null;
}

export function guardRestWriteCapability(
  config: AppConfig,
  methodName: string | null,
  requestId?: string,
  startupValidated = true
): { status: number; body: DsMcpStructuredError } | null {
  if (!methodName) return null;
  const blocked = guardWriteCapability(config, methodName, requestId, startupValidated);
  if (!blocked) return null;
  const status = blocked.error.code === "PLUGIN_DISABLED" || blocked.error.code === "DEGRADED_READ_ONLY" ? 503 : 409;
  return { status, body: blocked };
}

export function buildGetCapabilitiesResponse(config: AppConfig, input: {
  serviceVersion: string;
  startupValidated: boolean;
  security?: Record<string, unknown>;
  guardrails?: Record<string, unknown>;
  auth?: Record<string, unknown>;
}): Record<string, unknown> {
  const readiness = buildDsReadiness(config, input.startupValidated);
  const capabilities = getRuntimeCapabilities(config, input.startupValidated);
  return {
    ...readiness,
    version: input.serviceVersion,
    mcp_path: config.mcpPath,
    security: input.security,
    methods: capabilities,
    mcp_tools: capabilities.filter((capability) => capability.transport === "mcp" && capability.enabled).map((capability) => capability.name),
    rest_paths: READ_ONLY_REST_PATHS,
    guardrails: input.guardrails,
    auth: input.auth
  };
}
