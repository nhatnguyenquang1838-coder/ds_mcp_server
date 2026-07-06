# Design System MCP Server

Self-hosted MCP server for connecting ChatGPT / Workspace Agents to a Design System backend and guarded GitHub workflows.

## What this provides

This server supports two integration modes:

| Mode | Endpoint | Use case |
|---|---|---|
| MCP native connector | `/mcp` | ChatGPT Apps & Connectors / MCP connector |
| REST wrapper | `/api/...` | Custom GPT Actions using OpenAPI YAML |

Design System MCP tools:

| Tool | Type | Purpose |
|---|---|---|
| `ds_ping` | read | Health check from ChatGPT |
| `ds_get_request` | read | Fetch design request context by `request_id` |
| `ds_submit_agent_result` | write | Submit a completed agent review result back to the system |

GitHub MCP tools:

| Tool | Type | Purpose |
|---|---|---|
| `github_get_repo` | read | Read allowlisted repo metadata |
| `github_read_file` | read | Read UTF-8 file content |
| `github_create_branch` | write | Create guarded branch from base branch |
| `github_upsert_file` | write | Create/update file on guarded non-main branch |
| `github_create_pr` | write | Create pull request |
| `github_get_workflow_runs` | read | Read recent GitHub Actions workflow runs |
| `github_comment_pr` | write | Comment on pull request |

REST endpoints for GPT Actions:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/design-requests/{request_id}` | Fetch design request by ID |
| `POST` | `/api/agent-results` | Submit final agent review result |
| `GET` | `/api/github/repos/{owner}/{repo}` | Read repo metadata |
| `GET` | `/api/github/repos/{owner}/{repo}/files?path=...&ref=...` | Read file |
| `POST` | `/api/github/repos/{owner}/{repo}/branches` | Create branch |
| `POST` | `/api/github/repos/{owner}/{repo}/files` | Create/update file |
| `POST` | `/api/github/repos/{owner}/{repo}/pull-requests` | Create PR |
| `POST` | `/api/github/repos/{owner}/{repo}/pull-requests/{pr_number}/comments` | Comment PR |
| `GET` | `/api/github/repos/{owner}/{repo}/workflow-runs` | Read workflow runs |

This repo is intentionally small. It is the public-MCP and REST-action foundation for a larger workflow:

```text
Design System Backend / Custom GPT / ChatGPT
  -> reads design request or GitHub repo context
  -> creates guarded branch
  -> updates files on branch
  -> opens PR
  -> submits design review result or PR comment
```

## Requirements

- Node.js 20+
- npm
- Public HTTPS URL for ChatGPT connector usage
- GitHub fine-grained PAT or GitHub App token for GitHub gateway usage

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

## GitHub gateway setup

Set these env vars before using GitHub tools:

```env
GITHUB_TOKEN=github_pat_xxx
GITHUB_ALLOWED_REPOS=nhatnguyenquang1838-coder/ds_mcp_server,nhatnguyenquang1838-coder/rental_home
GITHUB_DEFAULT_BASE_BRANCH=main
GITHUB_ALLOWED_BRANCH_PREFIXES=feature/,fix/,chore/,docs/,ai/
```

Recommended fine-grained PAT permissions for MVP:

```text
Repository access: only selected repositories
Contents: Read and write
Pull requests: Read and write
Actions: Read-only
Metadata: Read-only
```

Guardrails:

```text
- Repository must be in GITHUB_ALLOWED_REPOS.
- Direct writes to main/master/production/prod are blocked.
- Write branches must start with feature/, fix/, chore/, docs/, or ai/ by default.
- File paths cannot start with /, contain .., or use Windows backslash.
- No merge/delete/force-push/secret-management endpoints are exposed.
```

GitHub REST read file test:

```bash
curl "http://localhost:8787/api/github/repos/nhatnguyenquang1838-coder/ds_mcp_server/files?path=README.md"
```

Create branch test:

```bash
curl -X POST http://localhost:8787/api/github/repos/nhatnguyenquang1838-coder/ds_mcp_server/branches \
  -H "Content-Type: application/json" \
  -d '{"branch":"docs/test-github-gateway","from_branch":"main"}'
```

Create/update file test:

```bash
curl -X POST http://localhost:8787/api/github/repos/nhatnguyenquang1838-coder/ds_mcp_server/files \
  -H "Content-Type: application/json" \
  -d '{
    "path":"docs/test-github-gateway.md",
    "content":"# Test GitHub Gateway\n",
    "branch":"docs/test-github-gateway",
    "message":"docs: test github gateway"
  }'
```

Create PR test:

```bash
curl -X POST http://localhost:8787/api/github/repos/nhatnguyenquang1838-coder/ds_mcp_server/pull-requests \
  -H "Content-Type: application/json" \
  -d '{
    "title":"docs: test github gateway",
    "head":"docs/test-github-gateway",
    "base":"main",
    "body":"## Summary\n- Test GitHub gateway\n\n## Validation\n- Manual API call",
    "draft":true
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
- Prefer GitHub App auth over PAT for multi-user/team production.

## Docker

```bash
docker build -t ds-mcp-server .
docker run --rm -p 8787:8787 --env-file .env ds-mcp-server
```
