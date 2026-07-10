# Requirements Document

## Introduction

This specification hardens browser and API behavior beyond basic authentication: security response headers, distributed rate limiting, bounded payloads, safe content types, standardized errors, and abuse controls suitable for Vercel/serverless deployment.

## Glossary

| Term | Definition |
|---|---|
| CSP | Content Security Policy. |
| HSTS | HTTP Strict Transport Security. |
| Distributed limiter | Rate limiter backed by shared storage rather than process memory. |
| Principal limit | Limit based on authenticated identity. |
| IP fallback | Limit used when no trusted principal exists. |

## Requirements

### Requirement 1: Security Response Headers

**User Story:** As a system owner, I want hardened browser responses, so that common injection and framing risks are reduced.

#### Acceptance Criteria

1. Admin HTML SHALL include a restrictive CSP.
2. Browser responses SHALL include `X-Content-Type-Options`, `Referrer-Policy`, and frame protection.
3. Production HTTPS responses SHOULD include HSTS.
4. Permissions Policy SHALL disable unused sensitive browser capabilities.

### Requirement 2: Distributed Rate Limiting

**User Story:** As an operator, I want consistent abuse protection across instances, so that serverless scaling cannot bypass limits.

#### Acceptance Criteria

1. Production rate limits SHALL use shared durable storage.
2. Authenticated requests SHALL be limited by principal and route class.
3. Unauthenticated failures SHALL use a privacy-conscious IP-derived key.
4. Rate-limited requests SHALL return `429` with a retry hint and SHALL NOT execute downstream work.

### Requirement 3: Endpoint-Specific Limits

**User Story:** As an operator, I want stricter limits for expensive operations, so that GitHub writes and uploads cannot be abused.

#### Acceptance Criteria

1. GitHub write operations SHALL use stricter limits than dashboard reads.
2. Upload and archive operations SHALL enforce size and frequency limits.
3. Login and credential administration SHALL have brute-force-resistant limits.
4. Limits SHALL be configurable without code changes.

### Requirement 4: Request Validation and Safe Errors

**User Story:** As a maintainer, I want consistent safe request handling, so that malformed input does not leak internals.

#### Acceptance Criteria

1. Unsupported content types SHALL be rejected.
2. Duplicate or ambiguous credential headers SHALL be rejected.
3. Client errors SHALL use stable error codes and request identifiers.
4. Server responses SHALL NOT include stack traces or secrets.

### Requirement 5: Validation

**User Story:** As a maintainer, I want automated hardening tests, so that deployment changes remain safe.

#### Acceptance Criteria

1. Tests SHALL verify CSP and security headers.
2. Tests SHALL verify limits across simulated instances using shared storage.
3. Tests SHALL confirm downstream handlers are not called after rejection.
4. Validation SHALL include production-like deployment configuration.
