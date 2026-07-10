# Implementation Plan

## Overview

Introduce machine identity after human RBAC foundations are available.

## Task Dependency Graph

```mermaid
graph TD
  T1[1. Define scopes] --> T2[2. Add key storage]
  T2 --> T3[3. Add key generation and verification]
  T3 --> T4[4. Add agent principal and scope enforcement]
  T3 --> T5[5. Add admin lifecycle APIs]
  T4 --> T6[6. Add audit attribution]
  T5 --> T6
  T6 --> T7[7. Add tests]
  T7 --> T8[8. Validate]
```

## Tasks

- [ ] 1. Define scopes
  - Declare task, workflow, GitHub, dashboard, and security scopes.
  - Map machine routes to scopes.
  - _Requirements: 2_

- [ ] 2. Add key storage
  - Add migration for hashed key metadata.
  - Add indexes for prefix and active status.
  - _Requirements: 1, 3_

- [ ] 3. Add key generation and verification
  - Generate one-time plaintext secrets.
  - Store secure hashes only.
  - _Requirements: 1_

- [ ] 4. Add agent principal and scope enforcement
  - Authenticate agent keys and enforce required route scopes.
  - _Requirements: 1, 2, 3_

- [ ] 5. Add admin lifecycle APIs
  - Add create, list metadata, revoke, and rotate operations.
  - Protect with `security:admin`.
  - _Requirements: 3, 4_

- [ ] 6. Add audit attribution
  - Record agent and key identifiers without secret material.
  - _Requirements: 5_

- [ ] 7. Add tests
  - Cover invalid, expired, revoked, wrong-scope, and rotated keys.
  - _Requirements: 1, 2, 3, 4, 5_

- [ ] 8. Validate
  - Run migrations, typecheck, build, and tests.
  - _Requirements: 5_

## Notes

- Depends on `SEC-WEB-02-admin-auth-rbac` for secure administration.
- Initial rollout may retain the shared REST bearer only as a time-bounded compatibility path.
