# Design Document

## Overview

Introduce a shared security layer in front of existing handlers. Preserve the lightweight Node HTTP server and current GitHub guardrails while making production strict by default.

## Architecture

```txt
request
  -> request id
  -> security headers / CORS
  -> route policy
  -> authentication
  -> rate and body limits
  -> existing handler
  -> audit and redaction
  -> response
```

## Components and Interfaces

### RoutePolicy

Suggested path:

```txt
src/security/routePolicy.ts
```

Responsibility:

- Classify public, MCP, REST, internal, dashboard, and webhook routes.
- Deny unmatched sensitive routes.

Interface:

```ts
type RouteAuthPolicy = "public" | "rest_bearer" | "mcp_bearer" | "internal_token" | "webhook_signature" | "disabled";
function resolveRoutePolicy(method: string, pathname: string): { routeId: string; policy: RouteAuthPolicy; sensitive: boolean };
```

### AuthEnforcer

Suggested path:

```txt
src/security/auth.ts
```

Responsibility:

- Validate the credential required by the resolved route.
- Use constant-time comparison for shared secrets.

Interface:

```ts
type AuthDecision =
  | { ok: true; principal: { type: "public" | "rest" | "mcp" | "internal" | "webhook"; id: string } }
  | { ok: false; status: 401 | 403; error: string };
```

### StartupValidation

Suggested path:

```txt
src/security/startupValidation.ts
```

Responsibility:

- Validate strict production configuration before binding the server port.

### RequestLimits

Suggested path:

```txt
src/security/requestLimits.ts
```

Responsibility:

- Bound body size and reject abusive requests before parsing or execution.

### Redaction

Suggested path:

```txt
src/security/redaction.ts
```

Responsibility:

- Remove authorization, cookies, tokens, keys, private keys, and secret-like fields.

## Data Models

### SecurityConfig

```ts
type SecurityConfig = {
  enforcement: "relaxed" | "strict";
  corsAllowedOrigins: string[];
  maxJsonBodyBytes: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  dashboardAuthRequired: boolean;
};
```

### SecurityAuditEvent

```ts
type SecurityAuditEvent = {
  timestamp: string;
  requestId: string;
  principalType: string;
  principalId?: string;
  routeId: string;
  action: string;
  status: "success" | "failure" | "denied";
  target?: Record<string, string>;
  reason?: string;
};
```

## Correctness Properties

A missing security policy must never result in public access.

Production must never start with an enabled sensitive surface and missing required credentials.

Rate-limited or oversized requests must never reach downstream write handlers.

Secrets must never be rendered, persisted in audit events, or returned to clients.

## Error Handling

Use `401` for absent or invalid credentials, `403` for authenticated but disallowed or disabled routes, `413` for oversized bodies, and `429` for rate limits. Do not return stack traces.

## Testing Strategy

Add route-policy, auth, startup-validation, request-size, CORS, redaction, and integration regression tests. Run:

```bash
npm run typecheck
npm run build
npm test
```

## Implementation Constraints

- Preserve `/health` as a non-sensitive public endpoint.
- Preserve GitHub webhook HMAC verification.
- Do not expose destructive GitHub tools.
- Do not commit real credentials.
- Do not weaken existing repository and protected-branch guardrails.
