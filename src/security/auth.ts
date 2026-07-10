import { timingSafeEqual, createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.js";
import type { RouteAuthPolicy } from "./routePolicy.js";
import { verifyOAuthAccessToken } from "./oauth.js";
import { isSupabaseConfigured } from "../db/supabaseClient.js";

export type Principal =
  | { type: "public"; id: "anonymous" }
  | { type: "rest"; id: "shared-rest-token" }
  | { type: "mcp"; id: "shared-mcp-token" }
  | { type: "oauth"; id: string; scopes: string[] }
  | { type: "internal"; id: "shared-internal-token" }
  | { type: "webhook"; id: "github-webhook" };

export type AuthDecision =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401 | 403; error: string };

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function constantTimeEquals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function bearerFromRequest(req: IncomingMessage): string | undefined {
  const authorization = headerValue(req, "authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length).trim();
}

function webhookSignatureMatches(secret: string, req: IncomingMessage): boolean {
  const signatureHeader = headerValue(req, "x-hub-signature-256");
  const signature = signatureHeader?.trim();
  const rawBody = headerValue(req, "__raw_body__");
  if (!signature?.startsWith("sha256=") || !rawBody) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(Buffer.from(rawBody, "base64")).digest("hex")}`;
  return constantTimeEquals(expected, signature);
}

export async function authorizeRoute(
  config: AppConfig,
  policy: RouteAuthPolicy,
  req: IncomingMessage
): Promise<AuthDecision> {
  if (policy === "public") {
    return { ok: true, principal: { type: "public", id: "anonymous" } };
  }

  if (policy === "disabled") {
    return { ok: false, status: 403, error: "Route is disabled" };
  }

  if (policy === "webhook_signature") {
    return { ok: true, principal: { type: "webhook", id: "github-webhook" } };
  }

  const bearer = bearerFromRequest(req);

  if (policy === "rest_bearer") {
    if (!config.restApiBearerToken) {
      return { ok: true, principal: { type: "public", id: "anonymous" } };
    }

    if (!bearer || !constantTimeEquals(config.restApiBearerToken, bearer)) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }

    return { ok: true, principal: { type: "rest", id: "shared-rest-token" } };
  }

  if (policy === "mcp_bearer") {
    if (config.mcpBearerToken && bearer && constantTimeEquals(config.mcpBearerToken, bearer)) {
      return { ok: true, principal: { type: "mcp", id: "shared-mcp-token" } };
    }

    if (bearer && isSupabaseConfigured(config)) {
      const oauthPrincipal = await verifyOAuthAccessToken(config, bearer);
      if (oauthPrincipal) {
        return { ok: true, principal: oauthPrincipal };
      }
    }

    if (!config.mcpBearerToken && !isSupabaseConfigured(config)) {
      return { ok: true, principal: { type: "public", id: "anonymous" } };
    }

    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (policy === "internal_token") {
    if (!config.workspaceAgentCallbackToken) {
      return { ok: false, status: 403, error: "Callback route is unavailable" };
    }

    if (!bearer || !constantTimeEquals(config.workspaceAgentCallbackToken, bearer)) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }

    return { ok: true, principal: { type: "internal", id: "shared-internal-token" } };
  }

  return { ok: false, status: 403, error: "Route is disabled" };
}
