# Design Document

## Overview

This design adds Phase 3 security hardening to the Design System MCP server. The design preserves the current lightweight Node HTTP server but adds explicit route security policy, strict production startup validation, GitHub App token preference, request hardening, durable audit extension points, and dashboard/capability redaction.

The implementation should be incremental and low-risk. Existing MCP and REST tool behavior should remain compatible in relaxed local mode, while production mode becomes fail-closed.

## Architecture

```txt
Incoming HTTP request
  -> CORS handling
  -> route normalization
  -> route security policy lookup
  -> auth enforcement
  -> rate/size guard
  -> handler
      -> schema validation
      -> domain/GitHub operation
      -> audit event
  -> redacted response
```

Security modules:

```txt
src/security/routePolicy.ts
src/security/auth.ts
src/security/requestLimits.ts
src/security/rateLimit.ts
src/security/redaction.ts
src/security/startupValidation.ts
src/tools/githubAuth.ts
src/tools/auditSink.ts
```

Existing handler modules remain in place. Security checks should be wired at the smallest shared entry point practical in `src/server.ts` and route-specific routers.

## Components and Interfaces

### RouteSecurityPolicy

Suggested path:

```txt
src/security/routePolicy.ts
```

Responsibility:

- Define explicit auth policy for public, REST, MCP, internal, dashboard, and GitHub routes.
- Fail closed when route classification is missing.
- Keep route policy readable and testable.

Interface:

```ts
export type RouteAuthPolicy =
  | "public"
  | "bearer_required"
  | "internal_token_required"
  | "disabled";

export type RouteSecurityDecision = {
  policy: RouteAuthPolicy;
  route_id: string;
  sensitive: boolean;
};

export function resolveRouteSecurityPolicy(input: {
  method: string;
  pathname: string;
}): RouteSecurityDecision;
```

### AuthEnforcer

Suggested path:

```txt
src/security/auth.ts
```

Responsibility:

- Validate MCP bearer, REST bearer, and internal callback token.
- Return consistent safe error decisions.
- Emit redacted auth failure context.

Interface:

```ts
export type AuthResult =
  | { ok: true; principal: "mcp" | "rest" | "internal" | "public" }
  | { ok: false; statusCode: 401 | 403; error: "Unauthorized" | "Forbidden" };

export function enforceAuth(input: {
  headers: Record<string, string | string[] | undefined>;
  policy: RouteAuthPolicy;
  config: AppConfig;
}): AuthResult;
```

### StartupSecurityValidation

Suggested path:

```txt
src/security/startupValidation.ts
```

Responsibility:

- Fail closed in production/strict mode.
- Validate required auth tokens for enabled sensitive surfaces.
- Validate GitHub auth mode and callback token posture.

Interface:

```ts
export type SecurityMode = "relaxed" | "strict";

export function validateStartupSecurity(config: AppConfig): void;
export function getSecurityMode(config: AppConfig): SecurityMode;
```

### RequestLimits

Suggested path:

```txt
src/security/requestLimits.ts
```

Responsibility:

- Bound JSON body size.
- Reject oversized payloads before parsing.
- Keep safe error responses consistent.

Interface:

```ts
export async function readLimitedJsonBody(input: {
  req: IncomingMessage;
  maxBytes: number;
}): Promise<unknown>;
```

### GitHubAuthProvider

Suggested path:

```txt
src/tools/githubAuth.ts
```

Responsibility:

- Prefer GitHub App installation tokens when configured.
- Fall back to PAT only when GitHub App config is absent.
- Hide raw token values from all outputs.

Interface:

```ts
export type GitHubAuthMode = "github_app" | "pat" | "unconfigured";

export async function getGitHubAuthorization(config: AppConfig): Promise<{
  mode: GitHubAuthMode;
  authorizationHeader: string;
}>;
```

### AuditSink

Suggested path:

```txt
src/tools/auditSink.ts
```

Responsibility:

- Write audit events to stdout and optional persistent storage.
- Redact sensitive fields.
- Provide a stable audit event schema.

Interface:

```ts
export type SecurityAuditEvent = {
  level: "audit";
  timestamp: string;
  action: string;
  source: "mcp" | "rest" | "internal" | "dashboard" | "github";
  route?: string;
  method?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  request_id?: string;
  run_id?: string;
  status: "success" | "failure" | "denied";
  reason?: string;
};

export async function writeSecurityAuditEvent(event: SecurityAuditEvent): Promise<void>;
```

### Redaction Utilities

Suggested path:

```txt
src/security/redaction.ts
```

Responsibility:

- Remove or mask `authorization`, tokens, private keys, service-role keys, cookies, and secret-like fields.
- Ensure capability/dashboard responses do not leak sensitive values.

Interface:

```ts
export function redactValue(value: unknown): unknown;
export function redactHeaders(headers: IncomingHttpHeaders): Record<string, unknown>;
export function isSecretFieldName(name: string): boolean;
```

## Data Models

### AppConfig Security Additions

```ts
type AppConfigSecurity = {
  securityEnforcement: "relaxed" | "strict";
  maxJsonBodyBytes: number;
  dashboardAuthRequired: boolean;
  corsAllowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;

  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubAppInstallationId?: string;
};
```

Mapping rules:

- `SECURITY_ENFORCEMENT=strict` maps to strict security mode.
- `NODE_ENV=production` implies strict mode unless explicitly overridden only for local test environments.
- Empty `CORS_ALLOWED_ORIGINS` in strict mode is invalid for browser-facing routes.
- GitHub App config is valid only when all required GitHub App fields are present.

### RouteSecurityDecision

```ts
type RouteSecurityDecision = {
  policy: "public" | "bearer_required" | "internal_token_required" | "disabled";
  route_id: string;
  sensitive: boolean;
};
```

Mapping rules:

- `/health` is public.
- `/api/capabilities` is public unless configured otherwise.
- `/dashboard/upstream-calls` and `/api/dashboard/upstream-calls` are public only when `DASHBOARD_AUTH_REQUIRED=false`.
- `/internal/*` requires internal callback token.
- `/api/github/*`, `/api/tasks*`, `/api/agent-runs*`, `/api/agent-results`, and `/api/design-requests*` require REST bearer in strict mode.
- Unmatched `/api/*` routes fail closed.

### SecurityAuditEvent

```ts
type SecurityAuditEvent = {
  level: "audit";
  timestamp: string;
  action: string;
  source: string;
  route?: string;
  method?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  request_id?: string;
  run_id?: string;
  status: "success" | "failure" | "denied";
  reason?: string;
};
```

Mapping rules:

- Auth failures use `status: "denied"`.
- Validation failures use `status: "failure"`.
- Successful writes use `status: "success"`.
- Tokens and raw payload secrets must never be included.

## Correctness Properties

### Auth Invariants

A sensitive route must never be accessible without its configured auth mechanism.

A missing route policy must not default to public.

Internal callback routes must not accept the general REST bearer token.

Production or strict mode must not run with missing MCP or REST secrets for enabled sensitive routes.

### GitHub Guardrail Invariants

A repo outside `GITHUB_ALLOWED_REPOS` must never reach the GitHub API call layer.

Protected branches must never be used as write targets.

GitHub tokens must never appear in logs, API responses, dashboard HTML, or audit events.

GitHub App auth must take priority over PAT auth when fully configured.

### Redaction Invariants

Authorization headers must never be persisted or rendered.

Capability responses may show boolean configured state, but not raw config values.

Dashboard data must escape HTML and must not include raw query strings containing secret-like values.

### Request Safety Invariants

Oversized request bodies must be rejected before JSON parsing.

Invalid JSON must not leak stack traces.

Rate-limited requests must not execute downstream write operations.

## Error Handling

- Missing or invalid bearer token: return `401 Unauthorized`.
- Route disabled by policy: return `403 Forbidden`.
- Unknown sensitive route with no policy: return `403 Forbidden`.
- Oversized JSON body: return `413 Payload Too Large`.
- Invalid JSON body: return `400 Invalid JSON body`.
- Invalid schema payload: return `400` with Zod flattened details, redacted.
- Missing strict-mode security config at startup: log redacted reason and exit non-zero.
- Persistent audit sink failure: log redacted sink failure; do not include secrets.

## Testing Strategy

Required tests:

- Route policy unit tests for all known public, REST, MCP, internal, dashboard, and unknown routes.
- Auth unit tests for missing, invalid, and valid bearer tokens.
- Strict startup validation tests for missing `MCP_BEARER_TOKEN`, `REST_API_BEARER_TOKEN`, and callback token.
- GitHub auth selection tests for GitHub App preferred over PAT.
- GitHub guardrail tests for disallowed repo and protected branch.
- Redaction tests for authorization headers, token-like fields, private keys, cookies, and service role keys.
- Request-size tests for oversized JSON.
- Dashboard/capabilities tests confirming no raw secrets are exposed.

Validation commands:

```bash
npm run typecheck
npm run build
npm test
```

If `npm test` is not configured, add the smallest project-consistent test runner setup or report honestly that only typecheck/build were available.

## Implementation Constraints

- Do not touch unrelated files.
- Do not expose merge, delete, force-push, or secret-management tools.
- Do not put secrets in tool output.
- Do not log authorization headers or token values.
- Keep write tools narrow and schema-validated.
- Preserve relaxed local development compatibility where practical.
- Use existing config loading patterns.
- Keep public capability output useful but redacted.
- Prefer GitHub App installation tokens over PAT for production.
- Report validation honestly.
