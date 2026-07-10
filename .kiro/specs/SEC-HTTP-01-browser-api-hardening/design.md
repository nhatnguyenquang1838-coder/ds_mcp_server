# Design Document

## Overview

Add shared HTTP middleware-like helpers around the existing Node server. Use a persistent rate-limit adapter in production and an in-memory adapter only for local tests.

## Architecture

```txt
request
  -> request id
  -> header validation
  -> security headers / CORS
  -> authentication
  -> distributed rate limiter
  -> bounded body / content type
  -> handler
  -> safe error mapper
```

## Components and Interfaces

### SecurityHeaders

Suggested path:

```txt
src/security/headers.ts
```

Interface:

```ts
function applySecurityHeaders(res: ServerResponse, surface: "html" | "api" | "download"): void;
```

### RateLimiter

Suggested path:

```txt
src/security/rateLimit.ts
```

Interface:

```ts
type RateLimitRule = { windowMs: number; max: number; routeClass: string };
interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}
```

### SafeErrorMapper

Suggested path:

```txt
src/security/errors.ts
```

Responsibility:

- Map known errors to stable public codes.
- Attach request IDs.
- Redact internal detail.

## Data Models

### RateLimitPolicy

```ts
type RateLimitPolicy = {
  routeClass: "login" | "read" | "task_write" | "github_write" | "upload" | "security_admin";
  windowMs: number;
  maxRequests: number;
};
```

## Correctness Properties

Rejected requests must never invoke downstream handlers.

Production rate limits must not depend on process-local memory.

CSP must not allow arbitrary script origins.

Errors must not expose stack traces or secret values.

## Error Handling

Return `415` for unsupported media type, `400` for ambiguous headers, `413` for oversized bodies, and `429` for rate limits. Include a stable code and request ID.

## Testing Strategy

Test headers, CSP, media types, duplicate credential headers, body bounds, per-principal limits, route-class limits, retry timing, and no-handler execution after rejection.

## Implementation Constraints

- Do not add wildcard production origins.
- Do not use in-memory rate limiting in production.
- Preserve download content disposition behavior.
- Keep policies configurable through validated environment settings.
