# GitHub Integrity Artifacts

`github_generate_integrity_artifacts` is a read-only GitHub gateway capability for producing repository integrity files without returning a raw repository archive to the caller.

## Purpose

Use this tool when an agent needs deterministic repository integrity evidence, especially:

- `TREE.txt` content from a Git tree;
- `SHA256SUMS.txt` content from repository blob bytes;
- a full commit SHA for the requested ref.

The tool is intended to replace ChatGPT-side ZIP extraction for governance integrity refresh flows.

## MCP tool

```text
github_generate_integrity_artifacts(owner, repo, ref?, exclude_paths?)
```

Input:

```json
{
  "owner": "nhatnguyenquang1838-coder",
  "repo": "gwc",
  "ref": "main",
  "exclude_paths": ["dist/generated.txt"]
}
```

Default excluded paths:

```text
SHA256SUMS.txt
TREE.txt
```

These defaults avoid self-referential checksum updates when refreshing the integrity files themselves.

## REST endpoint

```http
GET /api/github/repos/{owner}/{repo}/integrity-artifacts?ref=main&exclude_path=dist/generated.txt
Authorization: Bearer <REST_API_BEARER_TOKEN>
```

`exclude_path` may be repeated.

## Output

```json
{
  "owner": "nhatnguyenquang1838-coder",
  "repo": "gwc",
  "ref": "main",
  "commit_sha": "<40-char-sha>",
  "tree_sha": "<40-char-sha>",
  "tree_truncated": false,
  "excluded_paths": ["SHA256SUMS.txt", "TREE.txt"],
  "included_files": 10,
  "skipped_entries": [],
  "tree_txt": "100644 blob ...\tREADME.md\n",
  "sha256sums_txt": "<sha256>  README.md\n"
}
```

## Security controls

- Uses the existing `GITHUB_ALLOWED_REPOS` allowlist.
- Resolves the requested ref to a full commit SHA before reading the tree.
- Refuses truncated Git tree responses.
- Rejects unsafe paths, absolute paths, `..`, and Windows backslashes.
- Skips non-blob entries. Submodules are returned in `skipped_entries` with `reason: submodule-entry`.
- Does not expose ZIP/archive bytes, `content_base64`, repository credentials, or tokens.
- Does not create branches, commits, PRs, comments, deployments, or production data mutations.

## Limits

Each blob is bounded by `GITHUB_MAX_FILE_BYTES`. If a blob exceeds the configured limit, generation fails closed rather than producing incomplete checksum evidence.

## Validation

Expected checks:

```bash
npm test
npm run typecheck
npm run build
```
