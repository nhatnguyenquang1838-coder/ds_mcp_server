# Design System MCP Server

Self-hosted MCP server for connecting ChatGPT / Workspace Agents to a Design System backend.

## What this provides

This server supports two integration modes:

| Mode | Endpoint | Use case |
|---|---|---|
| MCP native connector | `/mcp` | ChatGPT Apps & Connectors / MCP connector |
| REST wrapper | `/api/...` | Custom GPT Actions using OpenAPI YAML |

Initial MCP tools:

| Tool | Type | Purpose |
|---|---|---|
| `ds_ping` | read | Health check from ChatGPT |
| `ds_get_request` | read | Fetch design request context by `request_id` |
| `ds_submit_agent_result` | write | Submit a completed agent review result back to the system |

REST endpoints for GPT Actions:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/design-requests/{request_id}` | Fetch design request by ID |
| `POST` | `/api/agent-results` | Submit final agent review result |

This repo is intentionally small. It is the public-MCP and REST-action foundation for a larger workflow:

```text
Design System Backend
  -> triggers ChatGPT Workspace Agent or Custom GPT
  -> Agent reads request context through MCP or REST Actions
  -> Agent submits result through ds_submit_agent_result or POST /api/agent-results
  -> Backend stores result and updates UI
```

## Requirements

- Node.js 20+
- npm
- Public HTTPS URL for ChatGPT connector usage

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Health check:

```bash
curl http://localhost:8787/health
```

Root check:

```bash
curl http://localhost:8787/
```

REST test:

```bash
curl http://localhost:8787/api/design-requests/DSR-001
```

Submit test result:

```bash
curl -X POST http://localhost:8787/api/agent-results \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "DSR-001",
    "decision": "revise",
    "summary": "Mobile layout needs cleanup before implementation.",
    "risk_level": "medium",
    "frontend_tasks": [
      {
        "title": "Fix InvoiceCard mobile overflow",
        "acceptance_criteria": [
          "No horizontal scroll at 360px viewport",
          "Invoice content remains readable in mobile card"
        ]
      }
    ],
    "validation": ["Run typecheck", "Test 360px viewport"]
  }'
```

## Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest \
  --server-url http://localhost:8787/mcp \
  --transport http
```

## Expose publicly for ChatGPT development

Example with ngrok:

```bash
ngrok http 8787
```

Use the public MCP endpoint in ChatGPT:

```text
https://<your-ngrok-domain>/mcp
```

## ChatGPT MCP connector setup

In ChatGPT:

```text
Settings
-> Apps & Connectors
-> Advanced settings
-> Developer mode
-> Create connector
```

Use:

```text
Name: Design System MCP
URL: https://<your-public-domain>/mcp
```

## Custom GPT Actions setup

Use `openapi.yaml` in this repo when configuring Custom GPT Actions.

Important: Custom GPT Actions should call REST endpoints, not `/mcp` directly.

Use server URL:

```text
https://<your-public-domain>
```

Available action paths:

```text
GET  /api/design-requests/{request_id}
POST /api/agent-results
```

## Optional bearer auth

For local prototype, `MCP_BEARER_TOKEN` may be empty.

Before exposing to the internet, set:

```env
MCP_BEARER_TOKEN=replace-with-a-long-random-token
```

Then MCP clients must send:

```http
Authorization: Bearer replace-with-a-long-random-token
```

Note: the REST wrapper currently does not require this bearer token. Add real auth before using it with sensitive data.

## Backend result forwarding

`ds_submit_agent_result` and `POST /api/agent-results` store result in memory and can also forward to your backend:

```env
DS_BACKEND_URL=https://your-backend.example.com
INTERNAL_AGENT_RESULT_TOKEN=change-me
```

Expected backend endpoint:

```text
POST /internal/agent-results
Header: X-Internal-Token: <INTERNAL_AGENT_RESULT_TOKEN>
Body: Agent result JSON
```

## Scripts

```bash
npm run dev        # local development
npm run typecheck  # TypeScript validation
npm run build      # compile to dist
npm start          # run compiled server
```

## Production notes

Minimum controls before production:

- Set `MCP_BEARER_TOKEN` or implement OAuth for MCP.
- Add auth for REST endpoints before using real data.
- Keep write tools narrow and schema-validated.
- Do not expose destructive tools in MVP.
- Do not put secrets in tool output.
- Audit all write calls.
- Validate agent result JSON again in the backend.

## Docker

```bash
docker build -t ds-mcp-server .
docker run --rm -p 8787:8787 --env-file .env ds-mcp-server
```
