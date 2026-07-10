# Design Document

## Overview

Extend existing audit output into a durable security event stream. Add a protected posture API/dashboard and lightweight signal aggregation without exposing credentials.

## Architecture

```txt
security event producer
  -> redaction
  -> durable audit sink
  -> signal aggregator
  -> protected security API/dashboard
  -> incident runbook
```

## Components and Interfaces

### AuditSink

Suggested path:

```txt
src/security/auditSink.ts
```

Interface:

```ts
type SecurityAuditEvent = {
  id: string;
  occurredAt: string;
  requestId: string;
  actorType: "user" | "agent" | "service" | "anonymous";
  actorId?: string;
  authMethod: string;
  routeId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  result: "success" | "failure" | "denied";
  reasonCode?: string;
};
```

### SecurityPostureService

Suggested path:

```txt
src/security/posture.ts
```

Interface:

```ts
type SecurityPosture = {
  enforcement: "relaxed" | "strict";
  restAuth: boolean;
  mcpAuth: boolean;
  dashboardAuth: boolean;
  corsAllowlist: boolean;
  distributedRateLimit: boolean;
  persistentAudit: boolean;
  webhookSignature: boolean;
};
```

### SignalAggregator

Suggested path:

```txt
src/security/signals.ts
```

Responsibility:

- Aggregate redacted events by actor, route, reason, and time window.
- Create severity-ranked signals.

## Data Models

### security_audit_events

Store normalized event columns plus a small redacted metadata JSON object.

### security_signals

Store signal type, severity, first/last observed timestamps, count, status, and references to supporting audit events.

## Correctness Properties

Audit events must never contain secrets.

Security posture must expose booleans/status only.

Audit and posture access must require security administration.

Retention purge must not delete data newer than the configured boundary.

## Error Handling

Audit persistence failures must be visible in logs and posture. For high-risk administrative actions, policy may fail closed when audit persistence is unavailable.

## Testing Strategy

Test schema validation, redaction, persistent writes, signal aggregation, retention boundaries, admin-only access, posture accuracy, and runbook examples.

## Implementation Constraints

- Reuse existing audit event producers where practical.
- Do not expose raw request bodies.
- Keep audit access itself audited.
- Document retention defaults and operational ownership.
