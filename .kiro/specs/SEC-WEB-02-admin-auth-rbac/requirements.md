# Requirements Document

## Introduction

The DS Admin Web currently has no human login or role-based authorization. This specification adds Supabase Auth sessions, server-side JWT verification, and role-based access for administrators, operators, and viewers.

Non-goals: agent API keys, social login expansion, tenant billing, and broad identity administration.

## Glossary

| Term | Definition |
|---|---|
| Supabase Auth | Identity provider used for human login and JWT issuance. |
| JWT | Signed access token representing an authenticated user. |
| RBAC | Role-based access control. |
| Admin | Human role with full dashboard and operational control. |
| Operator | Human role allowed to operate tasks but not administer security. |
| Viewer | Read-only human role. |

## Requirements

### Requirement 1: Human Login and Session

**User Story:** As an authorized user, I want to sign in securely, so that the admin dashboard is not anonymously accessible.

#### Acceptance Criteria

1. WHEN an unauthenticated browser opens `/admin` THEN the system SHALL present or redirect to a login flow.
2. WHEN Supabase returns a valid session THEN the web application SHALL attach the access token to API calls.
3. WHEN the session expires THEN protected calls SHALL fail and the UI SHALL require re-authentication.
4. WHEN the user logs out THEN local session state SHALL be cleared.

### Requirement 2: Server-Side JWT Verification

**User Story:** As a system owner, I want the server to verify user tokens, so that frontend claims cannot be trusted blindly.

#### Acceptance Criteria

1. WHEN a protected request contains a JWT THEN the server SHALL verify signature, issuer, audience, and expiry.
2. WHEN verification fails THEN the server SHALL return `401`.
3. WHEN verification succeeds THEN the server SHALL create a principal using server-derived user identity and roles.
4. The system SHALL NOT accept role or user identity from request-body fields.

### Requirement 3: Role-Based Authorization

**User Story:** As a system owner, I want least-privilege roles, so that users only access permitted operations.

#### Acceptance Criteria

1. WHEN a viewer requests a read route THEN the system SHALL allow access if the route policy permits viewers.
2. WHEN a viewer attempts a write THEN the system SHALL return `403`.
3. WHEN an operator manages tasks THEN the system SHALL allow task operations but SHALL deny security administration.
4. WHEN an admin accesses permitted management routes THEN the system SHALL allow access.
5. IF a user has no active role mapping THEN access SHALL be denied.

### Requirement 4: Secure Browser Storage

**User Story:** As a user, I want session handling that limits token exposure, so that XSS impact is reduced.

#### Acceptance Criteria

1. The frontend SHALL NOT embed REST, MCP, service-role, or GitHub tokens in static assets.
2. The Supabase service-role key SHALL remain server-only.
3. The UI SHALL NOT persist shared operational bearer tokens in `localStorage`.
4. Security-sensitive UI actions SHALL require a valid current session.

### Requirement 5: Auth UX and Tests

**User Story:** As a maintainer, I want clear auth behavior and automated tests, so that access rules remain predictable.

#### Acceptance Criteria

1. WHEN the API returns `401` THEN the UI SHALL route the user to re-authentication without infinite retries.
2. WHEN the API returns `403` THEN the UI SHALL show a permission error without hiding the underlying operation state.
3. Tests SHALL cover login-required routing, token verification, and role matrices.
4. Validation SHALL include typecheck, build, and tests.
