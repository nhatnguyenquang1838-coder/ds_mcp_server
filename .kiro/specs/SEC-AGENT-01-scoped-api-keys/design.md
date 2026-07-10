# Design Document

## Overview

Use prefix-based lookup plus a slow or keyed secure hash comparison. Separate machine authentication from Supabase human authentication and temporary shared bearer compatibility.

## Architecture

```txt
Authorization: Bearer ds_live_<prefix>_<secret>
  -> parse prefix
  -> load active key metadata
  -> verify hash
  -> validate expiry/revocation
  -> create agent principal
  -> enforce scope
```

## Components and Interfaces

### ApiKeyService

Suggested path:

```txt
src/security/apiKeys.ts
```

Interface:

```ts
type ApiKeyRecord = {
  id: string;
  prefix: string;
  secretHash: string;
  principalId: string;
  scopes: string[];
  status: "active" | "revoked";
  expiresAt?: string;
  lastUsedAt?: string;
};
```

### AgentAuthenticator

Suggested path:

```txt
src/security/agentAuth.ts
```

Interface:

```ts
type AgentPrincipal = {
  type: "agent";
  id: string;
  keyId: string;
  scopes: string[];
};
async function authenticateAgentKey(value: string): Promise<AgentPrincipal>;
```

### ScopeAuthorizer

Suggested path:

```txt
src/security/authorization.ts
```

Responsibility:

- Map machine routes to required scopes.
- Keep agent permissions separate from human roles.

## Data Models

### api_keys

```sql
id uuid primary key
name text not null
key_prefix text unique not null
key_hash text not null
principal_id text not null
scopes text[] not null
status text not null
expires_at timestamptz null
last_used_at timestamptz null
created_at timestamptz not null
revoked_at timestamptz null
```

## Correctness Properties

Plaintext secrets must never be persisted.

A revoked or expired key must never authenticate.

Scope checks must occur before downstream handlers.

Key metadata responses must never expose hashes.

## Error Handling

Return generic `401` for malformed, unknown, expired, or revoked keys. Return `403` for valid keys lacking scope. Do not reveal which key property failed.

## Testing Strategy

Test generation entropy boundaries, one-time display, hash verification, scope enforcement, expiry, revocation, rotation overlap, and audit redaction.

## Implementation Constraints

- Require human admin authorization for key management.
- Do not reuse REST, MCP, GitHub, or Supabase credentials as agent keys.
- Do not log credentials.
- Use a migration compatible with the current Supabase setup.
