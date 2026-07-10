import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { AppConfig } from "../config.js";
import { getSupabaseClient, isSupabaseConfigured } from "../db/supabaseClient.js";

const OAUTH_CLIENTS_TABLE = "mcp_oauth_clients";
const OAUTH_AUTH_CODES_TABLE = "mcp_oauth_authorization_codes";
const OAUTH_TOKENS_TABLE = "mcp_oauth_tokens";

const DEFAULT_SCOPE = "mcp";
const DEFAULT_AUTH_CODE_TTL_SECONDS = 300;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

type OAuthClientRecord = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_secret_hash: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

type OAuthAuthorizationCodeRecord = {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

type OAuthTokenRecord = {
  access_token_hash: string;
  refresh_token_hash: string;
  client_id: string;
  scope: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type OAuthAccessTokenPrincipal = {
  type: "oauth";
  id: string;
  scopes: string[];
};

export type OAuthMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
  protectedResourceMetadata: {
    resource: string;
    authorization_servers: string[];
    bearer_methods_supported: string[];
  };
};

export type OAuthClientRegistrationInput = {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
};

export type OAuthAuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state?: string;
  expiresInSeconds?: number;
};

export type OAuthTokenExchangeResult =
  | {
      ok: true;
      access_token: string;
      token_type: "Bearer";
      expires_in: number;
      refresh_token: string;
      scope: string;
    }
  | {
      ok: false;
      error: string;
      error_description?: string;
    };

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

function timingSafeHashEquals(expectedHash: string, actualHash: string): boolean {
  const expected = Buffer.from(expectedHash, "utf8");
  const actual = Buffer.from(actualHash, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function normalizeScope(scope: string | undefined): string {
  return (scope?.trim() || DEFAULT_SCOPE)
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function normalizeArray(values: string[] | undefined, fallback: string[]): string[] {
  if (!values || values.length === 0) return fallback;
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseClientAuthMethod(value: string | undefined): string {
  const normalized = (value || "none").trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "client_secret_basic" ||
    normalized === "client_secret_post"
  ) {
    return normalized;
  }
  return "none";
}

function validateRedirectUri(value: string): string {
  const url = new URL(value);
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (localHost) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("redirect_uri must use http or https for localhost");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("redirect_uri must use https");
  }
  return url.toString().replace(/\/+$/, "");
}

function expiresAtIso(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

function hasSupabase(config: AppConfig): boolean {
  return isSupabaseConfigured(config);
}

export function resolveOAuthIssuer(config: AppConfig, requestBaseUrl: string): string {
  return normalizeBaseUrl(config.publicBaseUrl || requestBaseUrl);
}

export function buildOAuthMetadata(config: AppConfig, requestBaseUrl: string): OAuthMetadata {
  const issuer = resolveOAuthIssuer(config, requestBaseUrl);
  return {
    issuer,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
    protectedResourceMetadata: {
      resource: issuer,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"]
    }
  };
}

export function buildOAuthMetadataJson(config: AppConfig, requestBaseUrl: string): unknown {
  const metadata = buildOAuthMetadata(config, requestBaseUrl);
  return {
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorizationEndpoint,
    token_endpoint: metadata.tokenEndpoint,
    registration_endpoint: metadata.registrationEndpoint,
    revocation_endpoint: metadata.revocationEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post"
    ],
    scopes_supported: [DEFAULT_SCOPE, "offline_access"],
    introspection_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"]
  };
}

export function buildOAuthProtectedResourceJson(
  config: AppConfig,
  requestBaseUrl: string
): unknown {
  const metadata = buildOAuthMetadata(config, requestBaseUrl);
  return {
    resource: metadata.protectedResourceMetadata.resource,
    authorization_servers: metadata.protectedResourceMetadata.authorization_servers,
    bearer_methods_supported: metadata.protectedResourceMetadata.bearer_methods_supported
  };
}

export async function registerOAuthClient(
  config: AppConfig,
  input: OAuthClientRegistrationInput
): Promise<{ client_id: string; client_secret?: string; token_endpoint_auth_method: string }> {
  if (!hasSupabase(config)) {
    throw new Error("Supabase is required for OAuth client registration");
  }

  const clientName = (input.client_name || "ChatGPT MCP Connector").trim();
  const redirectUris = normalizeArray(input.redirect_uris, []).map(validateRedirectUri);
  if (redirectUris.length === 0) {
    throw new Error("redirect_uris is required");
  }

  const grantTypes = normalizeArray(input.grant_types, ["authorization_code", "refresh_token"]);
  const responseTypes = normalizeArray(input.response_types, ["code"]);
  const tokenEndpointAuthMethod = parseClientAuthMethod(input.token_endpoint_auth_method);
  const clientId = `cli_${randomToken(18)}`;
  const clientSecret =
    tokenEndpointAuthMethod === "none" ? undefined : `sec_${randomToken(32)}`;
  const clientSecretHash = clientSecret ? sha256Base64Url(clientSecret) : null;

  const supabase = getSupabaseClient(config);
  const { error } = await supabase.from(OAUTH_CLIENTS_TABLE).insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    client_secret_hash: clientSecretHash,
    created_at: nowIso(),
    updated_at: nowIso(),
    revoked_at: null
  });

  if (error) {
    throw new Error(`Failed to register OAuth client: ${error.message}`);
  }

  return {
    client_id: clientId,
    client_secret: clientSecret,
    token_endpoint_auth_method: tokenEndpointAuthMethod
  };
}

export async function getOAuthClient(
  config: AppConfig,
  clientId: string
): Promise<OAuthClientRecord | undefined> {
  if (!hasSupabase(config)) return undefined;
  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase
    .from(OAUTH_CLIENTS_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load OAuth client: ${error.message}`);
  }

  return (data as OAuthClientRecord | null) ?? undefined;
}

function assertRedirectUriAllowed(client: OAuthClientRecord, redirectUri: string): void {
  if (!client.redirect_uris.includes(redirectUri)) {
    throw new Error("redirect_uri_mismatch");
  }
}

function assertClientSecret(
  client: OAuthClientRecord,
  clientSecret: string | undefined
): void {
  if (client.token_endpoint_auth_method === "none") return;
  if (!client.client_secret_hash || !clientSecret) {
    throw new Error("invalid_client");
  }

  const presented = sha256Base64Url(clientSecret);
  if (!timingSafeHashEquals(client.client_secret_hash, presented)) {
    throw new Error("invalid_client");
  }
}

export async function createOAuthAuthorizationCode(
  config: AppConfig,
  input: OAuthAuthorizationRequest
): Promise<{ code: string; expires_at: string }> {
  if (!hasSupabase(config)) {
    throw new Error("Supabase is required for OAuth authorization");
  }

  const client = await getOAuthClient(config, input.clientId);
  if (!client || client.revoked_at) {
    throw new Error("invalid_client");
  }

  assertRedirectUriAllowed(client, validateRedirectUri(input.redirectUri));

  const scope = normalizeScope(input.scope);
  const code = `code_${randomToken(32)}`;
  const codeHash = sha256Base64Url(code);
  const expiresAt = expiresAtIso(input.expiresInSeconds ?? DEFAULT_AUTH_CODE_TTL_SECONDS);
  const supabase = getSupabaseClient(config);
  const { error } = await supabase.from(OAUTH_AUTH_CODES_TABLE).insert({
    code_hash: codeHash,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    expires_at: expiresAt,
    used_at: null,
    created_at: nowIso()
  });

  if (error) {
    throw new Error(`Failed to store OAuth authorization code: ${error.message}`);
  }

  return { code, expires_at: expiresAt };
}

function parseBasicClientAuth(header: string | undefined): { client_id: string; client_secret: string } | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice("Basic ".length).trim(), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator <= 0) return undefined;
  return {
    client_id: decoded.slice(0, separator),
    client_secret: decoded.slice(separator + 1)
  };
}

async function resolveClientSecret(
  config: AppConfig,
  clientId: string,
  clientSecret: string | undefined
): Promise<void> {
  const client = await getOAuthClient(config, clientId);
  if (!client || client.revoked_at) {
    throw new Error("invalid_client");
  }
  assertClientSecret(client, clientSecret);
}

export async function getOAuthClientRecord(
  config: AppConfig,
  clientId: string
): Promise<OAuthClientRecord | undefined> {
  return getOAuthClient(config, clientId);
}

export async function exchangeOAuthAuthorizationCode(
  config: AppConfig,
  input: {
    clientId: string;
    clientSecret?: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }
): Promise<OAuthTokenExchangeResult> {
  if (!hasSupabase(config)) {
    return { ok: false, error: "server_error" };
  }

  try {
    await resolveClientSecret(config, input.clientId, input.clientSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_client";
    return { ok: false, error: message === "invalid_client" ? "invalid_client" : "server_error" };
  }

  const codeHash = sha256Base64Url(input.code);
  const supabase = getSupabaseClient(config);
  const { data: codeRow, error: codeError } = await supabase
    .from(OAUTH_AUTH_CODES_TABLE)
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (codeError) {
    return { ok: false, error: "server_error" };
  }

  const authCode = codeRow as OAuthAuthorizationCodeRecord | null;
  if (
    !authCode ||
    authCode.client_id !== input.clientId ||
    authCode.redirect_uri !== input.redirectUri ||
    authCode.used_at ||
    new Date(authCode.expires_at).getTime() <= Date.now() ||
    authCode.code_challenge_method !== "S256"
  ) {
    return { ok: false, error: "invalid_grant" };
  }

  const expectedChallenge = sha256Base64Url(input.codeVerifier);
  if (!timingSafeHashEquals(authCode.code_challenge, expectedChallenge)) {
    return { ok: false, error: "invalid_grant" };
  }

  const { data: consumed, error: consumeError } = await supabase
    .from(OAUTH_AUTH_CODES_TABLE)
    .update({ used_at: nowIso() })
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .select("*")
    .maybeSingle();

  if (consumeError || !consumed) {
    return { ok: false, error: "invalid_grant" };
  }

  const accessToken = `atk_${randomToken(32)}`;
  const refreshToken = `rtk_${randomToken(32)}`;
  const accessTokenHash = sha256Base64Url(accessToken);
  const refreshTokenHash = sha256Base64Url(refreshToken);
  const expiresAt = expiresAtIso(DEFAULT_ACCESS_TOKEN_TTL_SECONDS);

  const { error: tokenError } = await supabase.from(OAUTH_TOKENS_TABLE).insert({
    access_token_hash: accessTokenHash,
    refresh_token_hash: refreshTokenHash,
    client_id: input.clientId,
    scope: authCode.scope,
    expires_at: expiresAt,
    revoked_at: null,
    created_at: nowIso(),
    last_used_at: null
  });

  if (tokenError) {
    return { ok: false, error: "server_error" };
  }

  return {
    ok: true,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: authCode.scope
  };
}

export async function refreshOAuthAccessToken(
  config: AppConfig,
  input: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  }
): Promise<OAuthTokenExchangeResult> {
  if (!hasSupabase(config)) {
    return { ok: false, error: "server_error" };
  }

  try {
    await resolveClientSecret(config, input.clientId, input.clientSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_client";
    return { ok: false, error: message === "invalid_client" ? "invalid_client" : "server_error" };
  }

  const supabase = getSupabaseClient(config);
  const refreshTokenHash = sha256Base64Url(input.refreshToken);
  const { data: tokenRow, error: tokenError } = await supabase
    .from(OAUTH_TOKENS_TABLE)
    .select("*")
    .eq("refresh_token_hash", refreshTokenHash)
    .maybeSingle();

  if (tokenError) {
    return { ok: false, error: "server_error" };
  }

  const token = tokenRow as OAuthTokenRecord | null;
  if (
    !token ||
    token.client_id !== input.clientId ||
    token.revoked_at ||
    new Date(token.expires_at).getTime() <= Date.now()
  ) {
    return { ok: false, error: "invalid_grant" };
  }

  const accessToken = `atk_${randomToken(32)}`;
  const newRefreshToken = `rtk_${randomToken(32)}`;
  const accessTokenHash = sha256Base64Url(accessToken);
  const newRefreshTokenHash = sha256Base64Url(newRefreshToken);
  const expiresAt = expiresAtIso(DEFAULT_ACCESS_TOKEN_TTL_SECONDS);

  const { error: insertError } = await supabase.from(OAUTH_TOKENS_TABLE).insert({
    access_token_hash: accessTokenHash,
    refresh_token_hash: newRefreshTokenHash,
    client_id: input.clientId,
    scope: token.scope,
    expires_at: expiresAt,
    revoked_at: null,
    created_at: nowIso(),
    last_used_at: null
  });

  if (insertError) {
    return { ok: false, error: "server_error" };
  }

  const { error: revokeError } = await supabase
    .from(OAUTH_TOKENS_TABLE)
    .update({ revoked_at: nowIso() })
    .eq("refresh_token_hash", refreshTokenHash)
    .is("revoked_at", null);

  if (revokeError) {
    return { ok: false, error: "server_error" };
  }

  return {
    ok: true,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: newRefreshToken,
    scope: token.scope
  };
}

export async function verifyOAuthAccessToken(
  config: AppConfig,
  accessToken: string
): Promise<OAuthAccessTokenPrincipal | undefined> {
  if (!hasSupabase(config)) return undefined;

  const supabase = getSupabaseClient(config);
  const accessTokenHash = sha256Base64Url(accessToken);
  const { data, error } = await supabase
    .from(OAUTH_TOKENS_TABLE)
    .select("*")
    .eq("access_token_hash", accessTokenHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify OAuth access token: ${error.message}`);
  }

  const token = data as OAuthTokenRecord | null;
  if (
    !token ||
    token.revoked_at ||
    new Date(token.expires_at).getTime() <= Date.now()
  ) {
    return undefined;
  }

  await supabase
    .from(OAUTH_TOKENS_TABLE)
    .update({ last_used_at: nowIso() })
    .eq("access_token_hash", accessTokenHash);

  return {
    type: "oauth",
    id: token.client_id,
    scopes: normalizeScope(token.scope).split(" ")
  };
}

export async function revokeOAuthToken(
  config: AppConfig,
  token: string
): Promise<boolean> {
  if (!hasSupabase(config)) return false;

  const supabase = getSupabaseClient(config);
  const accessTokenHash = sha256Base64Url(token);
  const refreshTokenHash = sha256Base64Url(token);

  const [{ error: accessError }, { error: refreshError }] = await Promise.all([
    supabase
      .from(OAUTH_TOKENS_TABLE)
      .update({ revoked_at: nowIso() })
      .eq("access_token_hash", accessTokenHash)
      .is("revoked_at", null),
    supabase
      .from(OAUTH_TOKENS_TABLE)
      .update({ revoked_at: nowIso() })
      .eq("refresh_token_hash", refreshTokenHash)
      .is("revoked_at", null)
  ]);

  if (accessError || refreshError) {
    throw new Error("Failed to revoke OAuth token");
  }

  return true;
}

export function parseOAuthBasicClientAuth(header: string | undefined): { client_id: string; client_secret: string } | undefined {
  return parseBasicClientAuth(header);
}
