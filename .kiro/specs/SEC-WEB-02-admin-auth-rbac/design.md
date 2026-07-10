# Design Document

## Overview

Use Supabase Auth for human identity and keep authorization in the DS server. The browser supplies only a Supabase access token; the server verifies it and derives the user principal and role mapping.

## Architecture

```txt
browser -> Supabase login -> access JWT
browser -> DS API Authorization: Bearer JWT
DS API -> verify JWT -> load role -> authorize route -> handler
```

## Components and Interfaces

### AdminAuthClient

Suggested path:

```txt
public/admin/auth.js
```

Responsibility:

- Login, logout, session refresh, and authenticated API calls.
- Never expose service-role or shared operational tokens.

### SupabaseJwtVerifier

Suggested path:

```txt
src/security/supabaseJwt.ts
```

Interface:

```ts
type UserPrincipal = {
  type: "user";
  id: string;
  email?: string;
  roles: Array<"admin" | "operator" | "viewer">;
};
async function verifySupabaseJwt(token: string): Promise<UserPrincipal>;
```

### RoleAuthorizer

Suggested path:

```txt
src/security/authorization.ts
```

Interface:

```ts
type Permission =
  | "dashboard:read"
  | "tasks:read"
  | "tasks:write"
  | "github:read"
  | "github:write"
  | "security:admin";
function authorize(principal: UserPrincipal, permission: Permission): boolean;
```

## Data Models

### UserRole

```ts
type UserRole = {
  userId: string;
  role: "admin" | "operator" | "viewer";
  status: "active" | "disabled";
};
```

Mapping:

- `admin`: all declared human permissions.
- `operator`: dashboard/task read-write and approved GitHub operations.
- `viewer`: read-only dashboard/task access.

## Correctness Properties

Frontend-provided roles must never influence authorization.

A valid JWT without an active role mapping must not grant access.

Viewer access must never execute a write.

The service-role key must never be sent to the browser.

## Error Handling

Return `401` for invalid or expired JWTs and `403` for insufficient roles. The UI handles `401` by requiring login and handles `403` with an explicit permission message.

## Testing Strategy

Unit-test JWT claim validation and permission matrices. Add integration tests for admin, operator, viewer, disabled user, expired token, and forged role claims.

## Implementation Constraints

- Use existing Supabase dependency.
- Keep authorization server-side.
- Do not use email address alone as authorization.
- Do not remove machine-to-machine authentication required by other specs.
