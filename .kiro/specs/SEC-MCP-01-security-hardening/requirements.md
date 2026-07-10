# Requirements Document

## Introduction

The DS MCP server currently supports optional bearer authentication, but production can remain accessible when tokens are absent. This specification establishes the production perimeter: explicit route classification, fail-closed startup, protected dashboards and APIs, bounded requests, safe CORS, credential redaction, and security regression tests.

Non-goals: user login UI, long-lived agent API key lifecycle, destructive GitHub operations, and unrelated AgentOps workflow changes.

## Glossary

| Term | Definition |
|---|---|
| Sensitive route | A route that reads private operational data, writes state, triggers agents, or accesses GitHub. |
| Fail closed | Deny access or refuse startup when security configuration is incomplete. |
| REST bearer | Temporary shared credential for REST clients. |
| MCP bearer | Credential dedicated to the MCP endpoint. |
| Internal token | Credential dedicated to server-to-server callbacks. |

## Requirements

### Requirement 1: Explicit Route Security Policy

**User Story:** As a system owner, I want every route explicitly classified, so that sensitive routes never become public by default.

#### Acceptance Criteria

1. WHEN a request arrives THEN the system SHALL resolve an explicit route security policy before business handling.
2. WHEN a route is sensitive THEN the system SHALL require its configured authentication method.
3. IF a sensitive route has no policy THEN the system SHALL return `403 Forbidden`.
4. WHEN `/health` is requested THEN the system MAY allow anonymous access but SHALL NOT expose operational secrets.

### Requirement 2: Production Fail-Closed Startup

**User Story:** As an operator, I want insecure production configuration rejected, so that accidental public deployment is prevented.

#### Acceptance Criteria

1. WHEN production or strict mode starts without required REST or MCP credentials THEN the process SHALL exit non-zero.
2. WHEN an internal callback is enabled without its dedicated token THEN that callback SHALL remain unavailable.
3. WHEN startup validation fails THEN logs SHALL contain only redacted configuration details.
4. WHEN relaxed local mode is enabled THEN the capability response SHALL identify the relaxed posture without exposing secrets.

### Requirement 3: CORS and Request Controls

**User Story:** As an operator, I want browser and request boundaries, so that cross-origin and resource-exhaustion risks are reduced.

#### Acceptance Criteria

1. WHEN strict mode is active THEN CORS SHALL use an explicit origin allowlist.
2. WHEN a JSON body exceeds the configured maximum THEN the system SHALL return `413 Payload Too Large`.
3. WHEN JSON parsing fails THEN the system SHALL return a safe `400` response without stack traces.
4. WHEN rate limits are exceeded THEN the system SHALL return `429` before downstream work executes.

### Requirement 4: Secret Redaction and Audit

**User Story:** As an operator, I want security events recorded without secrets, so that incidents can be investigated safely.

#### Acceptance Criteria

1. WHEN authentication fails THEN the system SHALL emit a redacted denial audit event.
2. WHEN a sensitive write succeeds or fails THEN the system SHALL emit actor, route, action, target, status, and request identifier where available.
3. WHEN logs, dashboards, or APIs render request metadata THEN authorization, cookies, keys, and secret-like fields SHALL be removed.
4. IF persistent audit storage is configured THEN audit events SHALL also be written durably.

### Requirement 5: Security Regression Tests

**User Story:** As a maintainer, I want automated security tests, so that new routes cannot silently weaken the perimeter.

#### Acceptance Criteria

1. WHEN tests run THEN missing and invalid credentials SHALL be rejected for every sensitive route class.
2. WHEN tests run THEN public routes SHALL be verified not to expose secrets.
3. WHEN tests run THEN unknown sensitive routes SHALL fail closed.
4. WHEN validation completes THEN `npm run typecheck`, `npm run build`, and `npm test` SHALL pass.
