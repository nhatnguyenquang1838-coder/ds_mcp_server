# Requirements Document

## Introduction

Machine agents require credentials that are independent from human sessions and from shared REST tokens. This specification adds hashed, scoped, expiring, revocable API keys with per-agent identity and audit attribution.

## Glossary

| Term | Definition |
|---|---|
| API key | Machine credential issued to one agent or service. |
| Scope | Permission granted to an API key. |
| Key prefix | Non-secret identifier used to locate a stored key record. |
| Key hash | One-way representation of the secret portion. |
| Rotation | Replacement of a credential without uncontrolled downtime. |

## Requirements

### Requirement 1: Unique Agent Credentials

**User Story:** As an operator, I want each agent to have its own credential, so that access can be attributed and revoked independently.

#### Acceptance Criteria

1. WHEN a key is created THEN the system SHALL generate a unique public prefix and high-entropy secret.
2. The plaintext secret SHALL be returned only at creation time.
3. The database SHALL store only the key prefix and a secure hash of the secret.
4. WHEN a valid key is used THEN the system SHALL resolve an agent principal.

### Requirement 2: Scoped Authorization

**User Story:** As a system owner, I want agent permissions scoped, so that code agents cannot obtain unrelated administrative access.

#### Acceptance Criteria

1. WHEN an agent calls a route THEN the system SHALL require the route's declared scope.
2. WHEN the key lacks the scope THEN the system SHALL return `403`.
3. Task workers SHALL be configurable with `tasks:read`, `tasks:claim`, `tasks:heartbeat`, and `tasks:result` without admin scopes.
4. GitHub write access SHALL require an explicit `github:write` scope.

### Requirement 3: Expiry, Revocation, and Rotation

**User Story:** As an operator, I want key lifecycle controls, so that compromised credentials can be contained.

#### Acceptance Criteria

1. WHEN a key is expired or revoked THEN authentication SHALL fail.
2. WHEN a key is rotated THEN the replacement SHALL have an independently generated secret.
3. The system SHOULD support a bounded overlap window for controlled migration.
4. WHEN a key is used THEN `last_used_at` SHOULD be updated without storing request secrets.

### Requirement 4: Key Administration

**User Story:** As an admin, I want to create, list, revoke, and rotate keys, so that machine access can be managed safely.

#### Acceptance Criteria

1. Key administration SHALL require `security:admin`.
2. Key listings SHALL show metadata and prefix but SHALL NOT show secret or hash.
3. Key creation responses SHALL be non-cacheable.
4. Revocation SHALL take effect for subsequent requests.

### Requirement 5: Audit and Tests

**User Story:** As an operator, I want agent activity attributable, so that misuse can be investigated.

#### Acceptance Criteria

1. Audit events SHALL include agent identity, key identifier, scopes used, route, and outcome.
2. Audit events SHALL NOT include plaintext keys or hashes.
3. Tests SHALL cover valid, malformed, expired, revoked, wrong-scope, and rotated keys.
4. Validation SHALL include typecheck, build, tests, and migration verification.
