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
| `GET` | `/api/diagnostics/url-map` | Read safe URL and route diagnostics |

## Production URL map

Canonical production base URL:

```text
https://ds-mcp-server-one.vercel.app
```

| Surface | Production URL |
|---|---|
| Health | `https://ds-mcp-server-one.vercel.app/health` |
| MCP connector | `https://ds-mcp-server-one.vercel.app/mcp` |
| GitHub repo metadata | `https://ds-mcp-server-one.vercel.app/api/github/repos/{owner}/{repo}` |
| GitHub files | `https://ds-mcp-server-one.vercel.app/api/github/repos/{owner}/{repo}/files` |
| GitHub branches | `https://ds-mcp-server-one.vercel.app/api/github/repos/{owner}/{repo}/branches` |
| GitHub pull requests | `https://ds-mcp-server-one.vercel.app/api/github/repos/{owner}/{repo}/pull-requests` |
| GitHub workflow runs | `https://ds-mcp-server-one.vercel.app/api/github/repos/{owner}/{repo}/workflow-runs` |
| GitHub webhook | `https://ds-mcp-server-one.vercel.app/api/webhooks/github` |
| URL diagnostics | `https://ds-mcp-server-one.vercel.app/api/diagnostics/url-map` |

Manual verification:

```bash
curl -i https://ds-mcp-server-one.vercel.app/health
curl -i https://ds-mcp-server-one.vercel.app/mcp
curl -i -H "Authorization: Bearer $REST_API_BEARER_TOKEN" \
  https://ds-mcp-server-one.vercel.app/api/github/repos/dw18031988/ds_mcp_server
curl -i -H "Authorization: Bearer $REST_API_BEARER_TOKEN" \
  https://ds-mcp-server-one.vercel.app/api/diagnostics/url-map
```

The former `ds-mcp-server-theta.vercel.app` deployment is stale and must not be used as current production guidance.

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

## Security setup

The server now supports a stricter production perimeter:

- `SECURITY_ENFORCEMENT=strict` keeps sensitive routes fail-closed, while still allowing the server to boot when optional integrations like GitHub webhooks are not configured.
- `CORS_ALLOWED_ORIGINS` narrows browser access when you need cross-origin REST calls.
- `MAX_JSON_BODY_BYTES` limits request payload size before parsing.
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` control sensitive-route rate limiting.
- `GET /api/security/posture` reports the current security posture and recent signals.

In strict mode, the server expects Supabase to be configured so the rate limiter can use the `security_rate_limit_acquire` RPC instead of only in-memory state.

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
GITHUB_ALLOWED_REPOS=dw18031988/ds_mcp_server,nhatnguyenquang1838-coder/rental_home
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

## GitHub CI webhook setup

The AgentOps control plane exposes a GitHub webhook endpoint for CI/status callbacks:

```text
POST /api/webhooks/github
```

Production URL:

```text
https://ds-mcp-server-one.vercel.app/api/webhooks/github
```

Set this environment variable on the DS MCP deployment:

```env
GITHUB_WEBHOOK_SECRET=replace-with-a-long-random-secret
```

Then create a GitHub repository webhook with:

```text
Payload URL: https://ds-mcp-server-one.vercel.app/api/webhooks/github
Content type: application/json
Secret: same value as GITHUB_WEBHOOK_SECRET
SSL verification: enabled
```

Subscribe only to these events:

```text
workflow_run
check_run
check_suite
status
```

Webhook behavior:

- `ping` events return `202` and are ignored.
- Non-final CI events return `202` and are ignored.
- Final successful, neutral, or skipped CI results are normalized to `success`.
- Final failed, cancelled, timed out, action required, startup failure, or error results are normalized to `failure`.
- The normalized CI event is passed into the AgentOps GitHub CI handler, which matches waiting CI tasks by PR number or head SHA.
- This endpoint uses GitHub `X-Hub-Signature-256` verification and intentionally bypasses `REST_API_BEARER_TOKEN`, because GitHub cannot send the REST bearer token.

Local smoke test without signature, only when `GITHUB_WEBHOOK_SECRET` is unset:

```bash
curl -X POST http://localhost:8787/api/webhooks/github \
  -H "Content-Type: application/json" \
  -d '{"delivery_id":"manual-test-1","repo":"nhatnguyenquang1838-coder/rental_home","pr_number":101,"head_sha":"example","conclusion":"success"}'
```

GitHub REST read file test:

```bash
curl "http://localhost:8787/api/github/repos/dw18031988/ds_mcp_server/files?path=README.md"
```

Create branch test:

```bash
curl -X POST http://localhost:8787/api/github/repos/dw18031988/ds_mcp_server/branches \
  -H "Content-Type: application/json" \
  -d '{"branch":"docs/test-github-gateway","from_branch":"main"}'
```

Create/update file test:

```bash
curl -X POST http://localhost:8787/api/github/repos/dw18031988/ds_mcp_server/files \
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
curl -X POST http://localhost:8787/api/github/repos/dw18031988/ds_mcp_server/pull-requests \
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

OAuth discovery endpoints exposed by this server:

```text
https://<your-public-domain>/.well-known/oauth-authorization-server
https://<your-public-domain>/.well-known/oauth-protected-resource
https://<your-public-domain>/oauth/register
https://<your-public-domain>/oauth/authorize
https://<your-public-domain>/oauth/token
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

Use OAuth and point ChatGPT at the public MCP endpoint:

```text
Name: Design System MCP
URL: https://<your-public-domain>/mcp
Authentication: OAuth
```

If ChatGPT asks for OAuth endpoints, use:

```text
Authorization URL: https://<your-public-domain>/oauth/authorize
Token URL: https://<your-public-domain>/oauth/token
Registration URL: https://<your-public-domain>/oauth/register
Discovery URL: https://<your-public-domain>/.well-known/oauth-authorization-server
```

## Custom GPT Actions setup

Use the dedicated schema file for Custom GPT Actions:

```text
docs/openapi/ds-mcp-custom-agent-v2.yaml
```

Important: Custom GPT Actions should call REST endpoints, not `/mcp` directly.

Use server URL:

```text
https://<your-public-domain>
```

Authentication:

- Choose `API Key`
- Header name: `Authorization`
- Value format: `Bearer <REST_API_BEARER_TOKEN>`
- `GET /health` and `GET /api/capabilities` stay public for smoke tests

Quick smoke test:

```bash
curl https://<your-public-domain>/api/capabilities
curl -H "Authorization: Bearer <REST_API_BEARER_TOKEN>" https://<your-public-domain>/api/tasks
```

If the second call returns `401`, verify the bearer token matches the Vercel production environment variable exactly.

## MCP auth options

OAuth is the preferred connector flow.

For local tools like MCP Inspector, you can still use bearer auth:

```env
MCP_BEARER_TOKEN=replace-with-a-long-random-token
```

Then MCP clients must send:

```http
Authorization: Bearer replace-with-a-long-random-token
```

`MCP_URL_SECRET` is still supported as a temporary compatibility path, but new
ChatGPT connector setups should use OAuth.

If `PUBLIC_BASE_URL` is not set, the server falls back to `VERCEL_URL` when it is available in production.

The REST wrapper still enforces `REST_API_BEARER_TOKEN` for sensitive routes in production. Keep `GET /health` public, and use `GET /api/capabilities` only for connector smoke tests.
If you want a quick security check from the admin UI, load `/admin` with the bearer token and inspect the security posture panel.

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

- Set `PUBLIC_BASE_URL` when you want a stable OAuth issuer URL, or rely on `VERCEL_URL` on Vercel.
- Keep `MCP_BEARER_TOKEN` only for direct MCP clients and local inspection.
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
