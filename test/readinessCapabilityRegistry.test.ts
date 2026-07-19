import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "../src/config.js";
import {
  buildDsPingResponse,
  buildGetCapabilitiesResponse,
  evaluateCapabilityRegistryDrift,
  getRuntimeCapabilities,
  guardWriteCapability,
  shouldExposeCapability
} from "../src/readiness/capabilityRegistry.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8787,
    mcpPath: "/mcp",
    mcpBearerToken: "mcp-token",
    mcpUrlSecret: undefined,
    restApiBearerToken: "rest-token",
    designSystemBackendUrl: undefined,
    internalAgentResultToken: undefined,
    githubToken: "github-token",
    githubWebhookSecret: "webhook-secret",
    githubAllowedRepos: ["dw18031988/ds_mcp_server"],
    githubDefaultBaseBranch: "main",
    githubAllowedBranchPrefixes: ["feature/", "fix/", "chore/", "docs/", "ai/"],
    githubMaxFileBytes: 1_048_576,
    dsUploadSessionTtlSeconds: 3600,
    dsUploadChunkMaxBytes: 1_048_576,
    dsUploadMaxFileBytes: 10_485_760,
    dsUploadStorage: "memory",
    workspaceAgentTriggerId: undefined,
    workspaceAgentToken: undefined,
    workspaceAgentCallbackToken: undefined,
    workspaceAgentApiBaseUrl: "https://api.chatgpt.com",
    publicBaseUrl: "https://ds-mcp-server-one.vercel.app",
    supabaseUrl: undefined,
    supabaseServiceRoleKey: undefined,
    supabaseAnonKey: undefined,
    supabaseOauthProvider: "google",
    supabaseOauthScopes: ["openid", "email", "profile"],
    adminAllowedEmails: [],
    runtimeMode: "production",
    securityEnforcement: "strict",
    corsAllowedOrigins: [],
    maxJsonBodyBytes: 1_048_576,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 120,
    activeDbTarget: "default",
    devToolsEnabled: false,
    devToolsAllowRealDbSwitch: false,
    databaseProfiles: {},
    runtimeEnabled: true,
    writeEnabled: true,
    runtimeId: "test-runtime",
    ...overrides
  };
}

test("plugin disabled at startup blocks write-capable tools", () => {
  const disabled = config({ runtimeEnabled: false, writeEnabled: false });
  const ping = buildDsPingResponse(disabled);

  assert.equal(ping.enabled, false);
  assert.equal(ping.write_enabled, false);
  assert.equal(shouldExposeCapability(disabled, "task_transition"), false);
});

test("plugin enabled and healthy returns explicit readiness", () => {
  const healthy = config();
  const ping = buildDsPingResponse(healthy);

  assert.equal(ping.ok, true);
  assert.equal(ping.enabled, true);
  assert.equal(ping.authenticated, true);
  assert.equal(ping.write_enabled, true);
  assert.equal(ping.startup_validated, true);
  assert.equal(ping.service, "ds-mcp-server-one");
});

test("visible capability entries are authoritative and deterministic", () => {
  const healthy = config();
  const first = buildGetCapabilitiesResponse(healthy, { serviceVersion: "test", startupValidated: true });
  const second = buildGetCapabilitiesResponse(healthy, { serviceVersion: "test", startupValidated: true });

  assert.deepEqual(first, second);
  const methods = first.methods as Array<{ name: string; runtime_available: boolean }>;
  assert.ok(methods.some((method) => method.name === "task_transition" && method.runtime_available));
});

test("disabled after startup returns PLUGIN_DISABLED before dispatch", () => {
  const blocked = guardWriteCapability(config({ runtimeEnabled: false }), "task_transition", "req-1");

  assert.equal(blocked?.ok, false);
  assert.equal(blocked?.error.code, "PLUGIN_DISABLED");
  assert.equal(blocked?.error.request_id, "req-1");
});

test("schema/runtime mismatch reports TOOL_REGISTRY_DRIFT", () => {
  const evaluation = evaluateCapabilityRegistryDrift(config(), ["task_transition", "missing_tool"]);

  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.issues[0]?.error.code, "TOOL_REGISTRY_DRIFT");
  assert.equal(evaluation.issues[0]?.error.method, "missing_tool");
});

test("write call without readiness is blocked before mutation", () => {
  let mutated = false;
  const blocked = guardWriteCapability(config({ writeEnabled: false }), "github_upsert_file", "req-2");
  if (!blocked) mutated = true;

  assert.equal(mutated, false);
  assert.equal(blocked?.error.code, "DEGRADED_READ_ONLY");
});

test("read-only degraded mode keeps read-only capabilities available", () => {
  const degraded = config({ writeEnabled: false });
  const capabilities = getRuntimeCapabilities(degraded);
  const readFile = capabilities.find((method) => method.name === "github_read_file");
  const upsert = capabilities.find((method) => method.name === "github_upsert_file");

  assert.equal(buildDsPingResponse(degraded).write_enabled, false);
  assert.equal(readFile?.enabled, true);
  assert.equal(upsert?.enabled, false);
  assert.equal(shouldExposeCapability(degraded, "github_read_file"), true);
  assert.equal(shouldExposeCapability(degraded, "github_upsert_file"), false);
});

test("readiness errors preserve structure and avoid secret leakage", () => {
  const secretConfig = config({
    mcpBearerToken: "super-secret-mcp-token",
    restApiBearerToken: "super-secret-rest-token",
    githubToken: "super-secret-github-token",
    runtimeEnabled: false
  });
  const blocked = guardWriteCapability(secretConfig, "github_create_branch", "req-3");
  const serialized = JSON.stringify({
    ping: buildDsPingResponse(secretConfig),
    capabilities: buildGetCapabilitiesResponse(secretConfig, { serviceVersion: "test", startupValidated: true }),
    blocked
  });

  assert.equal(blocked?.ok, false);
  assert.equal(blocked?.error.retryable, false);
  assert.equal(serialized.includes("super-secret"), false);
});
