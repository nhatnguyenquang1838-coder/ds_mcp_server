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
  | { type: "admin"; id: string; email?: string }
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

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const raw = headerValue(req, "cookie");
  if (!raw) return undefined;
  for (const part of raw.split(/;\s*/)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(index + 1));
  }
  return undefined;
}

function adminEmailAllowed(config: AppConfig, email: string | undefined): boolean {
  if (!email) return false;
  if (config.adminAllowedEmails.length === 0) return true;
  return config.adminAllowedEmails.some((allowed) => allowed.toLowerCase() === email.toLowerCase());
}

async function verifySupabaseAdminToken(config: AppConfig, bearer: string): Promise<Principal | undefined> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return undefined;

  const response = await fetch(`${config.supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${bearer}`
    }
  });

  if (!response.ok) return undefined;

  const user = await response.json() as { id?: string; email?: string | null };
  if (!user.id || !adminEmailAllowed(config, user.email || undefined)) return undefined;

  return { type: "admin", id: `supabase:${user.id}`, email: user.email || undefined };
}

async function principalFromBearer(config: AppConfig, bearer: string | undefined): Promise<Principal | undefined> {
  if (!bearer) return undefined;

  if (config.mcpBearerToken && constantTimeEquals(config.mcpBearerToken, bearer)) {
    return { type: "mcp", id: "shared-mcp-token" };
  }

  if (config.restApiBearerToken && constantTimeEquals(config.restApiBearerToken, bearer)) {
    return { type: "rest", id: "shared-rest-token" };
  }

  const oauthPrincipal = await verifyOAuthAccessToken(config, bearer);
  if (oauthPrincipal) return oauthPrincipal;

  const adminPrincipal = await verifySupabaseAdminToken(config, bearer);
  if (adminPrincipal) return adminPrincipal;

  return undefined;
}

async function principalFromAdminSession(config: AppConfig, req: IncomingMessage): Promise<Principal | undefined> {
  const token = cookieValue(req, "dw_agentops_admin_session");
  if (!token) return undefined;
  const principal = await verifySupabaseAdminToken(config, token);
  return principal?.type === "admin" ? principal : undefined;
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
    const principal = await principalFromBearer(config, bearer);
    if (principal && ["rest", "oauth", "admin"].includes(principal.type)) {
      return { ok: true, principal };
    }
    if (!config.restApiBearerToken && !config.mcpBearerToken && !isSupabaseConfigured(config)) {
      return { ok: true, principal: { type: "public", id: "anonymous" } };
    }
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (policy === "admin_token") {
    const principal = await principalFromBearer(config, bearer) || await principalFromAdminSession(config, req);
    if (principal && principal.type === "admin") {
      return { ok: true, principal };
    }
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (policy === "mcp_bearer") {
    const principal = await principalFromBearer(config, bearer);
    if (principal && ["mcp", "oauth"].includes(principal.type)) {
      return { ok: true, principal };
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
