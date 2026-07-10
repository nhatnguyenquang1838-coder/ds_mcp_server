import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { loadConfig, type AppConfig } from "../src/config.js";
import { authorizeRoute } from "../src/security/auth.js";
import { acquireRateLimit } from "../src/security/rateLimit.js";
import { redactText, redactValue } from "../src/security/redaction.js";
import { resolveRoutePolicy } from "../src/security/routePolicy.js";
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

test("returns 401 for mismatched bearer tokens and 403 for disabled routes", () => {
  const config = baseConfig();
  const unauthorized = authorizeRoute(
    config,
    "rest_bearer",
    mockRequest("", { authorization: "Bearer wrong-token" })
  );

  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) {
    assert.equal(unauthorized.status, 401);
  }

  const disabled = authorizeRoute(config, "disabled", mockRequest(""));
  assert.equal(disabled.ok, false);
  if (!disabled.ok) {
    assert.equal(disabled.status, 403);
  }
});

test("returns 403 when internal callback token is missing", () => {
  const config = {
    ...baseConfig(),
    workspaceAgentCallbackToken: undefined
  };

  const decision = authorizeRoute(config, "internal_token", mockRequest(""));
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.status, 403);
  }
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
