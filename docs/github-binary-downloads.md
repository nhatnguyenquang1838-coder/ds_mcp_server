# GitHub binary-safe downloads

This change adds fallback REST endpoints and MCP tools for GitHub artifacts and repo archive downloads.

## Required GitHub token permissions

Use a fine-grained PAT or GitHub App installation token with at least:

```text
Contents: Read and write
Actions: Read-only
Metadata: Read-only
```

## REST endpoints

### List workflow run artifacts

```http
GET /api/github/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts
```

Example:

```bash
curl "https://ds-mcp-server-one.vercel.app/api/github/repos/dw18031988/ds_mcp_server/actions/runs/123456/artifacts"
```

### Download workflow artifact ZIP

```http
GET /api/github/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip
```

This endpoint returns `application/zip` and a `Content-Disposition` attachment filename.

Example:

```bash
curl -L -o artifact.zip "https://ds-mcp-server-one.vercel.app/api/github/repos/dw18031988/ds_mcp_server/actions/artifacts/987654/zip"
```

### Download repo archive ZIP

```http
GET /api/github/repos/{owner}/{repo}/archive?ref=main
```

This endpoint returns a zipball for a branch, tag, or commit ref.

Example:

```bash
curl -L -o repo-main.zip "https://ds-mcp-server-one.vercel.app/api/github/repos/dw18031988/ds_mcp_server/archive?ref=main"
```

## MCP tools

### `github_list_workflow_run_artifacts`

Input:

```json
{
  "owner": "dw18031988",
  "repo": "ds_mcp_server",
  "run_id": 123456,
  "per_page": 30
}
```

Returns GitHub Actions artifact metadata as JSON.

### `github_download_workflow_artifact_zip`

Input:

```json
{
  "owner": "dw18031988",
  "repo": "ds_mcp_server",
  "artifact_id": 987654
}
```

Returns:

```json
{
  "file_name": "ds_mcp_server-artifact-987654.zip",
  "content_type": "application/zip",
  "size_bytes": 12345,
  "encoding": "base64",
  "content_base64": "..."
}
```

### `github_download_repo_archive_zip`

Input:

```json
{
  "owner": "dw18031988",
  "repo": "ds_mcp_server",
  "ref": "main"
}
```

Returns ZIP content as base64 metadata. For large archives, prefer the REST endpoint because MCP responses can become too large.

## Notes

- These paths are binary-safe and do not try to decode ZIP files as UTF-8.
- Repo allowlist rules still apply through `GITHUB_ALLOWED_REPOS`.
- If `REST_API_BEARER_TOKEN` is configured, REST callers must pass `Authorization: Bearer <token>`.
- Very large artifacts or archives may still hit hosting/runtime/MCP payload limits.
