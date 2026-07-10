import assert from "node:assert/strict";
import test from "node:test";
import { getUrlDiagnostics, normalizeBaseUrl } from "../src/urlDiagnostics.js";

test("normalizeBaseUrl trims a trailing slash", () => {
  assert.equal(
    normalizeBaseUrl("https://ds-mcp-server-one.vercel.app/"),
    "https://ds-mcp-server-one.vercel.app"
  );
});

test("getUrlDiagnostics returns safe canonical route metadata", () => {
  const diagnostics = getUrlDiagnostics({
    baseUrl: "https://ds-mcp-server-one.vercel.app/",
    environment: "production",
    mcpPath: "/mcp"
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.service, "ds-mcp-server");
  assert.equal(diagnostics.environment, "production");
  assert.equal(diagnostics.baseUrl, "https://ds-mcp-server-one.vercel.app");
  assert.equal(diagnostics.routes.health, "/health");
  assert.equal(diagnostics.routes.mcp, "/mcp");
  assert.equal(diagnostics.routes.diagnostics, "/api/diagnostics/url-map");
  assert.equal(diagnostics.routes.githubRepo, "/api/github/repos/{owner}/{repo}");
  assert.equal(diagnostics.routes.githubWebhook, "/api/webhooks/github");
});
