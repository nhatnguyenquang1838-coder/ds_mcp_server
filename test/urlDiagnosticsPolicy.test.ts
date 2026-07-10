import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoutePolicy } from "../src/security/routePolicy.js";

test("URL diagnostics remains public under centralized security", () => {
  assert.deepEqual(resolveRoutePolicy("GET", "/api/diagnostics/url-map"), {
    routeId: "public.url-diagnostics",
    policy: "public",
    sensitive: false
  });
});

test("other unknown API routes remain disabled", () => {
  assert.deepEqual(resolveRoutePolicy("GET", "/api/unknown-route"), {
    routeId: "unknown.sensitive",
    policy: "disabled",
    sensitive: true
  });
});
