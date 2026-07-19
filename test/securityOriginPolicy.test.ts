import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { DEFAULT_CORS_ALLOWED_ORIGINS, loadConfig, type AppConfig } from "../src/config.js";
import { authorizeRoute } from "../src/security/auth.js";
import { resolveRoutePolicy } from "../src/security/routePolicy.js";

function baseConfig(): AppConfig {
  return {
    ...loadConfig(),
    securityEnforcement: "strict",
    rateLimitWindowMs: 1_000,
    rateLimitMaxRequests: 1,
    restApiBearerToken: "rest-token",
    mcpBearerToken: "mcp-token",
    workspaceAgentCallbackToken: undefined,
    corsAllowedOrigins: ["https://chatgpt.com"]
  };
}

function mockRequest(body: string, headers: Record<string, string> = {}): any {
  const stream = Readable.from([Buffer.from(body)]);
  return Object.assign(stream, {
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  }) as any;
}

test("allows request from configured origin", async () => {
  const config = baseConfig();
  const req = mockRequest("", { 
    origin: "https://chatgpt.com",
    authorization: "Bearer rest-token" 
  });

  const decision = await authorizeRoute(config, "rest_bearer", req);
  assert.equal(decision.ok, true);
});

test("verifies route policy for sensitive task transitions", () => {
  const policy = resolveRoutePolicy("POST", "/api/tasks/{task_id}/transitions");
  assert.equal(policy.routeId, "rest.sensitive");
  assert.equal(policy.sensitive, true);
});

test("verifies route policy for github gateway", () => {
  const policy = resolveRoutePolicy("GET", "/api/github/repos/owner/repo");
  assert.equal(policy.routeId, "github.gateway");
  assert.equal(policy.sensitive, true);
});

test("accepts loopback origins in non-production mode", async () => {
  const config = {
    ...baseConfig(),
    runtimeMode: "local" as const,
    securityEnforcement: "strict" as const
  };
  const req = mockRequest("", { 
    origin: "http://localhost:8787",
    authorization: "Bearer rest-token" 
  });

  const decision = await authorizeRoute(config, "rest_bearer", req);
  assert.equal(decision.ok, true);
});

test("allows request without Origin header (server-to-server)", async () => {
  const config = baseConfig();
  // No origin header provided
  const req = mockRequest("", { 
    authorization: "Bearer rest-token" 
  });

  const decision = await authorizeRoute(config, "rest_bearer", req);
  assert.equal(decision.ok, true);
});

test("provides the trusted ChatGPT origins when the allowlist is not configured", () => {
  assert.deepEqual(DEFAULT_CORS_ALLOWED_ORIGINS, ["https://chatgpt.com", "https://chat.openai.com"]);
});

test("accepts the configured public deployment origin", async () => {
  const config = {
    ...baseConfig(),
    publicBaseUrl: "https://ds-mcp-server-one.vercel.app"
  };
  const req = mockRequest("", {
    origin: "https://ds-mcp-server-one.vercel.app",
    authorization: "Bearer rest-token"
  });

  const decision = await authorizeRoute(config, "rest_bearer", req);
  assert.equal(decision.ok, true);
});
