# DS Upload Gateway: No-Dependency First Design

## Decision

DS MCP should support agent file handoff through DS-owned upload sessions, but the MVP should not add any new runtime npm dependency.

Use Node.js built-ins first:

- `node:http` for existing REST routing.
- `Buffer` for base64 chunk decode.
- `node:crypto` for SHA-256 checksum validation.
- In-memory session state for the first MVP.
- Existing guarded GitHub gateway functions for final commit and PR flow.

## Why

The current server is intentionally small and already exposes MCP plus REST gateway modes. Adding heavy upload middleware or git libraries too early increases deployment size, cold-start risk, and operational surface.

The immediate problem is not local file storage. The immediate problem is avoiding large full-file content through ChatGPT/MCP/GitHub connector payloads. Chunked handoff solves that with smaller request bodies.

## Current Constraint

The existing `github_upsert_file` and `github_push_file` style tools still require the caller to provide the full final file content in one request. That is fine for small files, but fragile for large generated files or full-file replacements.

The upload gateway should split file transfer from GitHub commit.

## Target Flow

```text
Agent / ChatGPT / Codex
  -> DS create upload session
  -> DS receive file chunks
  -> DS verify size + sha256
  -> DS assemble final content server-side
  -> DS commit to guarded non-main branch
  -> DS open PR
  -> DS monitor CI
```

## MVP REST Endpoints

```text
POST /api/github/repos/{owner}/{repo}/upload-sessions
PUT  /api/github/repos/{owner}/{repo}/upload-sessions/{session_id}/chunks/{part_number}
POST /api/github/repos/{owner}/{repo}/upload-sessions/{session_id}/complete
POST /api/github/repos/{owner}/{repo}/upload-sessions/{session_id}/commit
GET  /api/github/repos/{owner}/{repo}/upload-sessions/{session_id}
```

## MVP MCP Tools

```text
github_create_upload_session
github_upload_chunk
github_complete_upload
github_commit_upload_session
```

## Request Body Rule

Each chunk should be small enough to avoid serverless request body limits and connector truncation risk.

Recommended default:

```text
DS_UPLOAD_CHUNK_MAX_BYTES=1048576
```

This keeps each chunk around 1 MiB raw before base64 overhead.

## Config

```env
DS_UPLOAD_SESSION_TTL_SECONDS=3600
DS_UPLOAD_CHUNK_MAX_BYTES=1048576
DS_UPLOAD_MAX_FILE_BYTES=10485760
DS_UPLOAD_STORAGE=memory
```

Future storage options:

```env
DS_UPLOAD_STORAGE=filesystem
DS_UPLOAD_STORAGE=supabase-storage
DS_UPLOAD_STORAGE=s3
```

## Size Policy

```text
0-5 MiB      normal upload session and Git commit
5-50 MiB     allow with warning and audit event
50-100 MiB   block by default unless explicit override exists
>100 MiB     reject regular Git commit; use LFS or object storage
```

## Path Policy

Allowed write roots should remain narrow:

```text
.kiro/specs/**
docs/**
src/**
tests/**
scripts/**
```

Blocked paths:

```text
.env
.env.*
.git/**
node_modules/**
dist/**
build/**
coverage/**
secrets/**
```

## Checksum Contract

Upload session creation requires:

```json
{
  "path": "docs/example.md",
  "branch": "docs/example-branch",
  "message": "docs: add example",
  "size_bytes": 12345,
  "sha256": "hex-encoded-sha256"
}
```

On `complete`, DS SHALL:

1. Verify all expected chunks exist.
2. Verify assembled byte length.
3. Verify SHA-256.
4. Mark session as `completed`.
5. Refuse commit if checksum does not match.

## Commit Strategy

For MVP, commit the assembled UTF-8 file through the existing guarded GitHub gateway.

Do not introduce local `git` CLI in the first slice.

Reason:

- No extra binary dependency.
- No local repo checkout lifecycle.
- Lower operational risk on Vercel/serverless.
- Existing allowlist, branch, and path guardrails can be reused.

Later, when DS moves to a durable worker/container runtime, add a Git worker adapter:

```text
Upload Gateway -> durable storage -> Git Worker -> git commit/push -> PR
```

## Node Module Decision

MCP server can use node modules. It is just a Node.js service. But for this feature, adding a module is not necessary.

Avoid these in MVP:

- `multer`
- `busboy`
- `formidable`
- `simple-git`
- `isomorphic-git`

Reconsider later only if requirements change:

- True multipart file uploads from browser UI.
- Local repo checkout and multi-file atomic commits.
- Git LFS integration.
- Durable background workers.

## Implementation Slices

### Slice 1: Session store

- Add in-memory upload session store.
- Track session metadata, chunks, status, created time, expiry time.
- Add checksum verification.

### Slice 2: REST routes

- Add create/chunk/complete/commit/read routes.
- Keep chunk payload as JSON with `content_base64`.
- Enforce `DS_UPLOAD_CHUNK_MAX_BYTES` after base64 decode.

### Slice 3: MCP tools

- Register equivalent MCP tools.
- Mark upload and commit tools as write actions.
- Return compact structured results, never return full assembled content.

### Slice 4: GitHub commit

- Reuse guarded GitHub commit path.
- Commit only after session status is `completed`.
- Write audit event with owner/repo/branch/path/session_id.

### Slice 5: CI loop

- After PR creation, use existing workflow-run lookup and PR comment flow.
- Schedule follow-up CI check when PR is pushed.

## Non-Goals For MVP

- No SFTP server.
- No local git checkout.
- No Git LFS upload.
- No binary artifact storage.
- No multi-file atomic commit.
- No durable storage guarantee across server restart.

## Risks

| Risk | Mitigation |
|---|---|
| Server restart loses memory sessions | Keep MVP explicitly short-lived; add Supabase/S3 later |
| Large chunk exceeds platform body limit | Default 1 MiB chunk size |
| Base64 overhead | Decode and validate raw byte size server-side |
| Binary file committed to Git accidentally | Add extension/type policy before binary support |
| Branch conflict | Reuse guarded branch rules and fail fast |
| CI fail after PR | Existing CI monitor loop should report and trigger fix cycle |

## Recommended Next Code Change

Implement Slice 1 and Slice 2 without changing `package.json` dependencies.
