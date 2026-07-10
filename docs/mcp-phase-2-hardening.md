# MCP Phase 2 Hardening

This phase adds safety and production-readiness controls around the Design System MCP server and REST Actions gateway.

## Changes

- REST API bearer auth using `REST_API_BEARER_TOKEN` for sensitive routes.
- Public capability endpoint at `GET /api/capabilities`.
- Zod validation for GitHub REST write payloads.
- Audit log events for REST and MCP write actions.
- Service version bump to `0.3.0`.
- Configurable GitHub file size limit using `GITHUB_MAX_FILE_BYTES`.

## REST auth behavior

Sensitive REST routes require:

```http
Authorization: Bearer <REST_API_BEARER_TOKEN>
```

Public exceptions:

```text
GET /health
GET /api/capabilities
```

`GET /api/capabilities` stays public for connector/tool debugging and does not expose secrets.

## MCP connector behavior

For ChatGPT MCP connectors, use a capability URL secret instead of static bearer auth:

```env
MCP_URL_SECRET=replace-with-a-long-random-secret
```

Connector URL:

```text
https://ds-mcp-server-one.vercel.app/mcp/<MCP_URL_SECRET>
```

Connector auth:

```text
No Authentication
```

For local debugging, `MCP_BEARER_TOKEN` can still be used with MCP Inspector and other direct clients.

## Capability check

```bash
curl https://ds-mcp-server-one.vercel.app/api/capabilities
```

Expected fields:

```text
service
version
mcp_path
mcp_tools
rest_paths
guardrails
auth
```

## Audit log format

Write actions log structured JSON to stdout:

```json
{
  "level": "audit",
  "timestamp": "2026-07-06T00:00:00.000Z",
  "action": "github_create_pr",
  "source": "mcp",
  "owner": "dw18031988",
  "repo": "ds_mcp_server",
  "branch": "ai/example",
  "pr_number": 123,
  "status": "success"
}
```

Vercel runtime logs can be used as the audit sink for MVP.

## New env vars

```env
REST_API_BEARER_TOKEN=
GITHUB_MAX_FILE_BYTES=256000
```

## Recommended next phase

Phase 3 should replace PAT-based GitHub access with GitHub App installation tokens and add persistent audit storage.
