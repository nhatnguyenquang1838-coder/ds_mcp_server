import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { loadConfig, type AppConfig } from "../src/config.js";
import { authorizeRoute } from "../src/security/auth.js";
import {
  buildOAuthMetadataJson,
  buildOAuthProtectedResourceJson
} from "../src/security/oauth.js";
import { buildSecurityPosture } from "../src/security/posture.js";
import {
  acquireRateLimit,
  buildRateLimitBucketKey,
  buildRateLimitRpcArgs
} from "../src/security/rateLimit.js";
import { redactText, redactValue } from "../src/security/redaction.js";
import { resolveRateLimitPolicy, resolveRoutePolicy } from "../src/security/routePolicy.js";
import {
  validateSecurityRuntimeDependencies,
  validateSecurityStartup
} from "../src/security/startupValidation.js";
import { PayloadTooLargeError, readRawBody } from "../src/security/requestLimits.js";
import type { IncomingMessage } from "node:http";

function baseConfig(): AppConfig {
  return {
    ...loadConfig(),
    securityEnforcement: "relaxed",
    rateLimitWindowMs: 1_000,
    rateLimitMaxRequests: 1,
    restApiBearerToken: "rest-token",
    mcpBearerToken: "mcp-token",
    workspaceAgentCallbackToken: undefined,
    corsAllowedOrigins: ["https://chatgpt.com"]
  };
}

function mockRequest(body: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  return Object.assign(stream, {
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  }) as unknown as IncomingMessage;
}

test("resolves unknown api routes as disabled", () => {
  const policy = resolveRoutePolicy("POST", "/api/unknown-sensitive-route");
  assert.equal(policy.policy, "disabled");
  assert.equal(policy.sensitive, true);
});

test("treats mcp path secret routes as disabled without explicit server handling", () => {
  const policy = resolveRoutePolicy("POST", "/mcp/secret-value");
  assert.equal(policy.policy, "disabled");
  assert.equal(policy.sensitive, true);
});

test("treats oauth routes as public", () => {
  const policy = resolveRoutePolicy("GET", "/.well-known/oauth-authorization-server");
  assert.equal(policy.policy, "public");
  assert.equal(policy.sensitive, false);
});

test("treats security posture routes as protected", () => {
  const policy = resolveRoutePolicy("GET", "/api/security/posture");
  assert.equal(policy.policy, "rest_bearer");
  assert.equal(policy.sensitive, true);
});

test("resolves route-specific rate limit policies", () => {
  const oauthPolicy = resolveRateLimitPolicy("POST", "/oauth/token");
  assert.equal(oauthPolicy?.label, "oauth");
  assert.equal(oauthPolicy?.maxRequests, 10);

  const securityPolicy = resolveRateLimitPolicy("GET", "/api/security/posture");
  assert.equal(securityPolicy?.label, "security-admin");
  assert.equal(securityPolicy?.maxRequests, 60);
});

test("returns 401 for mismatched bearer tokens and 403 for disabled routes", async () => {
  const config = baseConfig();
  const unauthorized = await authorizeRoute(
    config,
    "rest_bearer",
    mockRequest("", { authorization: "Bearer wrong-token" })
  );

  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) {
    assert.equal(unauthorized.status, 401);
  }

  const disabled = await authorizeRoute(config, "disabled", mockRequest(""));
  assert.equal(disabled.ok, false);
  if (!disabled.ok) {
    assert.equal(disabled.status, 403);
  }
});

test("returns 403 when internal callback token is missing", async () => {
  const config = {
    ...baseConfig(),
    workspaceAgentCallbackToken: undefined
  };

  const decision = await authorizeRoute(config, "internal_token", mockRequest(""));
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.status, 403);
  }
});

test("builds oauth metadata from the configured public base url", () => {
  const config = {
    ...baseConfig(),
    publicBaseUrl: "https://example.com"
  };

  const metadata = buildOAuthMetadataJson(config, "http://localhost:8787") as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    authorization_response_iss_parameter_supported: boolean;
    resource_parameter_supported: boolean;
  };

  assert.equal(metadata.issuer, "https://example.com");
  assert.equal(metadata.authorization_endpoint, "https://example.com/oauth/authorize");
  assert.equal(metadata.token_endpoint, "https://example.com/oauth/token");
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal(metadata.resource_parameter_supported, true);
});

test("builds protected resource metadata for resource-scoped paths", () => {
  const config = {
    ...baseConfig(),
    publicBaseUrl: "https://example.com"
  };

  const metadata = buildOAuthMetadataJson(config, "http://localhost:8787");
  assert.ok(metadata);

  const protectedMetadata = buildOAuthProtectedResourceJson(config, "http://localhost:8787", "mcp") as {
    resource: string;
  };
  assert.equal(protectedMetadata.resource, "https://example.com/mcp");
});

test("treats resource-scoped protected resource metadata routes as public", () => {
  const rootScoped = resolveRoutePolicy("GET", "/.well-known/oauth-protected-resource/mcp");
  assert.equal(rootScoped.policy, "public");

  const suffixScoped = resolveRoutePolicy("GET", "/mcp/.well-known/oauth-protected-resource");
  assert.equal(suffixScoped.policy, "public");
});

test("builds security posture snapshots", () => {
  const config = {
    ...baseConfig(),
    githubWebhookSecret: undefined,
    corsAllowedOrigins: []
  };

  const posture = buildSecurityPosture(config);
  assert.equal(posture.ok, true);
  assert.equal(posture.controls.some((control) => control.name === "REST bearer"), true);
  assert.equal(posture.controls.some((control) => control.name === "GitHub webhook" && !control.configured), true);
});

test("allows strict startup without webhook secret or cors allowlist when core auth is configured", () => {
  const config = {
    ...baseConfig(),
    securityEnforcement: "strict",
    corsAllowedOrigins: [],
    githubWebhookSecret: undefined,
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key"
  };

  const startup = validateSecurityStartup(config);
  assert.equal(startup.ok, true);
});

test("rejects request bodies that exceed the configured limit", async () => {
  await assert.rejects(
    () => readRawBody(mockRequest("abcdef"), 3),
    PayloadTooLargeError
  );
});

test("applies memory rate limiting in relaxed mode", async () => {
  const unique = `security-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const config = {
    ...baseConfig(),
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 1
  };

  const first = await acquireRateLimit(config, {
    routeId: unique,
    principalId: unique,
    clientKey: unique
  });
  assert.equal(first.allowed, true);

  const second = await acquireRateLimit(config, {
    routeId: unique,
    principalId: unique,
    clientKey: unique
  });
  assert.equal(second.allowed, false);
  if (!second.allowed) {
    assert.equal(second.limit, 1);
    assert.ok(second.retryAfterSeconds >= 1);
  }
});

test("builds rate limit rpc args with the postgres function parameter names", () => {
  assert.deepEqual(buildRateLimitRpcArgs("bucket", 60_000, 10), {
    p_bucket_key: "bucket",
    p_window_ms: 60_000,
    p_max_requests: 10
  });
});

test("builds json-safe bucket keys for the rate limit rpc", () => {
  assert.equal(
    buildRateLimitBucketKey("oauth.token", "principal", "127.0.0.1"),
    "[\"oauth.token\",\"principal\",\"127.0.0.1\"]"
  );
});

test("skips runtime dependency probes outside strict supabase mode", async () => {
  const result = await validateSecurityRuntimeDependencies(baseConfig());
  assert.deepEqual(result, { ok: true, issues: [] });
});

test("redacts secrets in structured data and text", () => {
  assert.equal(redactText("Bearer abc123.secret-token"), "Bearer [REDACTED]");
  assert.deepEqual(
    redactValue({
      authorization: "Bearer abc123",
      token: "super-secret",
      nested: {
        message: "token=abcd1234"
      }
    }),
    {
      authorization: "[REDACTED]",
      token: "[REDACTED]",
      nested: {
        message: "token=[REDACTED]"
      }
    }
  );
});
