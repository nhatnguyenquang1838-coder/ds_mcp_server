import type { AppConfig } from "../config.js";

export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

export type GitHubFileResult = {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  sha?: string;
  content: string;
  encoding: "utf-8";
  html_url?: string;
};

export type GitHubBinaryFileResult = {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  sha?: string;
  size?: number;
  encoding: "base64";
  content_base64: string;
  html_url?: string;
};

export type GitHubBranchResult = {
  owner: string;
  repo: string;
  branch: string;
  sha: string;
};

export type GitHubUpsertFileInput = GitHubRepoRef & {
  path: string;
  content: string;
  branch: string;
  message: string;
};

export type GitHubApplyTextPatchInput = GitHubRepoRef & {
  path: string;
  branch: string;
  message: string;
  old_text: string;
  new_text: string;
  expected_replacements?: number;
  replace_all?: boolean;
};

export type GitHubCommitFilesInput = GitHubRepoRef & {
  branch: string;
  message: string;
  files?: Array<{ path: string; content: string }>;
  deletions?: string[];
  expected_base_sha?: string;
};

export type GitHubDeleteFileInput = GitHubRepoRef & {
  path: string;
  branch: string;
  message: string;
};

export type GitHubPullRequestInput = GitHubRepoRef & {
  title: string;
  head: string;
  base?: string;
  body?: string;
  draft?: boolean;
};

export type GitHubMergePullRequestInput = GitHubRepoRef & {
  pr_number: number;
  commit_title?: string;
  commit_message?: string;
  merge_method?: "merge" | "squash" | "rebase";
};

export type GitHubMarkPullRequestReadyInput = GitHubRepoRef & {
  pr_number: number;
};

export type GitHubClosePullRequestInput = GitHubRepoRef & {
  pr_number: number;
};

export type GitHubForceUpdateBranchInput = GitHubRepoRef & {
  branch: string;
  sha: string;
  expected_current_sha?: string;
};

export type GitHubWorkflowDispatchInput = GitHubRepoRef & {
  workflow_id: string | number;
  ref: string;
  inputs?: Record<string, string | number | boolean>;
};

export type GitHubBinaryResult = {
  owner: string;
  repo: string;
  file_name: string;
  content_type: string;
  content: Buffer;
};

type GitHubErrorBody = {
  message?: string;
  documentation_url?: string;
};

type GitHubContentResponse = {
  type: string;
  encoding?: string;
  content?: string;
  sha?: string;
  path?: string;
  html_url?: string;
  size?: number;
};

type GitHubRefResponse = {
  ref: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
};

type GitHubCommitResponse = {
  sha: string;
  html_url?: string;
  tree: {
    sha: string;
    url: string;
  };
};

type GitHubBlobResponse = {
  sha: string;
  url: string;
};

type GitHubTreeResponse = {
  sha: string;
  url: string;
  truncated?: boolean;
  tree: Array<{
    path?: string;
    mode?: string;
    type?: string;
    sha?: string;
    size?: number;
    url?: string;
  }>;
};

type GitHubTreeCreateResponse = {
  sha: string;
  url: string;
  tree: Array<{
    path?: string;
    mode?: string;
    type?: string;
    sha?: string;
    size?: number;
    url?: string;
  }>;
};

type GitHubUpsertResponse = {
  content?: {
    path?: string;
    sha?: string;
    html_url?: string;
  };
  commit?: {
    sha?: string;
    html_url?: string;
  };
};

type GitHubPullResponse = {
  number: number;
  node_id?: string;
  html_url: string;
  state: string;
  title: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
};

type GitHubMergePullResponse = {
  sha: string;
  merged: boolean;
  message: string;
};

type GitHubRepoResponse = {
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  permissions?: Record<string, boolean>;
};

type GitHubWorkflowRunsResponse = {
  total_count: number;
  workflow_runs: Array<{
    id: number;
    name?: string;
    head_branch?: string;
    head_sha?: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
    created_at?: string;
    updated_at?: string;
  }>;
};

type GitHubArtifactsResponse = {
  total_count: number;
  artifacts: Array<{
    id: number;
    node_id?: string;
    name: string;
    size_in_bytes?: number;
    url?: string;
    archive_download_url?: string;
    expired?: boolean;
    created_at?: string;
    updated_at?: string;
    expires_at?: string;
    workflow_run?: {
      id?: number;
      head_branch?: string;
      head_sha?: string;
    };
  }>;
};

function requireGitHubToken(config: AppConfig): string {
  if (!config.githubToken) {
    throw new Error("GITHUB_TOKEN is not configured");
  }
  return config.githubToken;
}

function fullRepoName(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function assertAllowedRepo(config: AppConfig, owner: string, repo: string): void {
  const fullName = fullRepoName(owner, repo);

  if (config.githubAllowedRepos.length === 0) {
    throw new Error("GITHUB_ALLOWED_REPOS is not configured");
  }

  if (!config.githubAllowedRepos.includes(fullName)) {
    throw new Error(`Repository is not allowlisted: ${fullName}`);
  }
}

function assertSafePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(`Unsafe repository path: ${path}`);
  }
}

function toGitHubContentPath(path: string): string {
  assertSafePath(path);
  return path.split("/").map(encodeURIComponent).join("/");
}

function toGitHubRefPath(branch: string): string {
  return encodeURIComponent(branch);
}

function assertWritableBranch(config: AppConfig, branch: string): void {
  const protectedBranches = new Set(["main", "master", "production", "prod"]);

  if (protectedBranches.has(branch)) {
    throw new Error(`Direct writes to protected branch are blocked: ${branch}`);
  }

  const allowed = config.githubAllowedBranchPrefixes.some((prefix) => branch.startsWith(prefix));

  if (!allowed) {
    throw new Error(
      `Branch must start with one of: ${config.githubAllowedBranchPrefixes.join(", ")}`
    );
  }
}

function assertCommitSha(value: string, name = "sha"): void {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}

function assertTextByteLimit(config: AppConfig, content: string, path: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > config.githubMaxFileBytes) {
    throw new Error(
      `File exceeds GITHUB_MAX_FILE_BYTES: ${path} is ${bytes} bytes, limit is ${config.githubMaxFileBytes}`
    );
  }
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

async function githubFetch<T>(
  config: AppConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = requireGitHubToken(config);
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = `GitHub API failed: ${response.status}`;

    try {
      const body = (await response.json()) as GitHubErrorBody;
      if (body.message) message = `${message} ${body.message}`;
    } catch {
      // Keep generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function githubGraphqlFetch<T>(
  config: AppConfig,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const token = requireGitHubToken(config);
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL API failed: ${response.status}`);
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL API failed: ${payload.errors.map((error) => error.message).join("; ")}`);
  }
  if (!payload.data) {
    throw new Error("GitHub GraphQL API returned no data");
  }

  return payload.data;
}

async function githubFetchNoContent(
  config: AppConfig,
  path: string,
  init: RequestInit = {}
): Promise<void> {
  const token = requireGitHubToken(config);
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = `GitHub API failed: ${response.status}`;

    try {
      const body = (await response.json()) as GitHubErrorBody;
      if (body.message) message = `${message} ${body.message}`;
    } catch {
      // Keep generic message.
    }

    throw new Error(message);
  }
}

async function githubFetchBinary(
  config: AppConfig,
  path: string,
  fileName: string
): Promise<{ content: Buffer; content_type: string; file_name: string }> {
  const token = requireGitHubToken(config);
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    let message = `GitHub binary download failed: ${response.status}`;

    try {
      const body = (await response.json()) as GitHubErrorBody;
      if (body.message) message = `${message} ${body.message}`;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = `${message} ${text.slice(0, 200)}`;
    }

    throw new Error(message);
  }

  return {
    content: Buffer.from(await response.arrayBuffer()),
    content_type: response.headers.get("content-type") || "application/zip",
    file_name: safeFileName(fileName)
  };
}

async function getBranchRef(
  config: AppConfig,
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubRefResponse> {
  return githubFetch<GitHubRefResponse>(
    config,
    `/repos/${owner}/${repo}/git/ref/heads/${toGitHubRefPath(branch)}`
  );
}

async function getBranchHeadSha(
  config: AppConfig,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const ref = await getBranchRef(config, owner, repo, branch);
  return ref.object.sha;
}

async function resolveCommitSha(
  config: AppConfig,
  owner: string,
  repo: string,
  ref: string
): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
  return getBranchHeadSha(config, owner, repo, ref);
}

async function tryGetFileSha(
  config: AppConfig,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | undefined> {
  try {
    const file = await githubFetch<GitHubContentResponse>(
      config,
      `/repos/${owner}/${repo}/contents/${toGitHubContentPath(path)}?ref=${encodeURIComponent(ref)}`
    );
    return file.sha;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return undefined;
    }
    throw error;
  }
}

export async function githubGetRepo(config: AppConfig, input: GitHubRepoRef) {
  assertAllowedRepo(config, input.owner, input.repo);

  const repo = await githubFetch<GitHubRepoResponse>(
    config,
    `/repos/${input.owner}/${input.repo}`
  );

  return {
    full_name: repo.full_name,
    private: repo.private,
    default_branch: repo.default_branch,
    html_url: repo.html_url,
    permissions: repo.permissions ?? {}
  };
}

export async function githubReadFile(
  config: AppConfig,
  input: GitHubRepoRef & { path: string; ref?: string }
): Promise<GitHubFileResult> {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);

  const query = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
  const file = await githubFetch<GitHubContentResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/contents/${toGitHubContentPath(input.path)}${query}`
  );

  if (file.type !== "file" || file.encoding !== "base64" || !file.content) {
    throw new Error(`Path is not a UTF-8 file: ${input.path}`);
  }

  return {
    owner: input.owner,
    repo: input.repo,
    path: file.path ?? input.path,
    ref: input.ref,
    sha: file.sha,
    content: Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8"),
    encoding: "utf-8",
    html_url: file.html_url
  };
}

export async function githubReadBinaryFile(
  config: AppConfig,
  input: GitHubRepoRef & { path: string; ref?: string }
): Promise<GitHubBinaryFileResult> {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);

  const query = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
  const file = await githubFetch<GitHubContentResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/contents/${toGitHubContentPath(input.path)}${query}`
  );

  if (file.type !== "file" || file.encoding !== "base64" || !file.content) {
    throw new Error(`Path is not a base64 file response: ${input.path}`);
  }

  return {
    owner: input.owner,
    repo: input.repo,
    path: file.path ?? input.path,
    ref: input.ref,
    sha: file.sha,
    size: file.size,
    encoding: "base64",
    content_base64: file.content.replace(/\n/g, ""),
    html_url: file.html_url
  };
}

export async function githubListTree(
  config: AppConfig,
  input: GitHubRepoRef & { ref?: string; recursive?: boolean }
) {
  assertAllowedRepo(config, input.owner, input.repo);

  const ref = input.ref || config.githubDefaultBaseBranch;
  const commitSha = await resolveCommitSha(config, input.owner, input.repo, ref);
  const commit = await githubFetch<GitHubCommitResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/commits/${commitSha}`
  );

  const params = new URLSearchParams();
  if (input.recursive ?? true) params.set("recursive", "1");

  const tree = await githubFetch<GitHubTreeResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/trees/${commit.tree.sha}?${params.toString()}`
  );

  return {
    owner: input.owner,
    repo: input.repo,
    ref,
    commit_sha: commitSha,
    tree_sha: tree.sha,
    truncated: tree.truncated ?? false,
    tree: tree.tree.map((item) => ({
      path: item.path,
      mode: item.mode,
      type: item.type,
      sha: item.sha,
      size: item.size,
      url: item.url
    }))
  };
}

export async function githubCreateBranch(
  config: AppConfig,
  input: GitHubRepoRef & { branch: string; from_branch?: string }
): Promise<GitHubBranchResult> {
  assertAllowedRepo(config, input.owner, input.repo);
  assertWritableBranch(config, input.branch);

  const fromBranch = input.from_branch || config.githubDefaultBaseBranch;
  const baseRef = await getBranchRef(config, input.owner, input.repo, fromBranch);

  await githubFetch<GitHubRefResponse>(config, `/repos/${input.owner}/${input.repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: `refs/heads/${input.branch}`,
      sha: baseRef.object.sha
    })
  });

  return {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    sha: baseRef.object.sha
  };
}

export async function githubUpsertFile(
  config: AppConfig,
  input: GitHubUpsertFileInput
) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);
  assertWritableBranch(config, input.branch);
  assertTextByteLimit(config, input.content, input.path);

  const existingSha = await tryGetFileSha(
    config,
    input.owner,
    input.repo,
    input.path,
    input.branch
  );

  const payload: Record<string, unknown> = {
    message: input.message,
    content: Buffer.from(input.content, "utf8").toString("base64"),
    branch: input.branch
  };

  if (existingSha) payload.sha = existingSha;

  const result = await githubFetch<GitHubUpsertResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/contents/${toGitHubContentPath(input.path)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  return {
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    branch: input.branch,
    content_sha: result.content?.sha,
    commit_sha: result.commit?.sha,
    html_url: result.content?.html_url
  };
}

export async function githubApplyTextPatch(
  config: AppConfig,
  input: GitHubApplyTextPatchInput
) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);
  assertWritableBranch(config, input.branch);

  if (!input.old_text) {
    throw new Error("old_text must not be empty");
  }

  const current = await githubReadFile(config, {
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    ref: input.branch
  });

  const actual = countOccurrences(current.content, input.old_text);
  const expected = input.expected_replacements ?? 1;

  if (actual !== expected) {
    throw new Error(
      `Patch guard failed for ${input.path}: expected ${expected} occurrence(s), found ${actual}`
    );
  }

  const nextContent = input.replace_all
    ? current.content.split(input.old_text).join(input.new_text)
    : current.content.replace(input.old_text, input.new_text);

  assertTextByteLimit(config, nextContent, input.path);

  const output = await githubUpsertFile(config, {
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    content: nextContent,
    branch: input.branch,
    message: input.message
  });

  return {
    ...output,
    previous_sha: current.sha,
    replacements: actual
  };
}

export async function githubCommitFiles(config: AppConfig, input: GitHubCommitFilesInput) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertWritableBranch(config, input.branch);

  const files = input.files ?? [];
  const deletions = input.deletions ?? [];

  if (files.length === 0 && deletions.length === 0) {
    throw new Error("At least one file or deletion is required");
  }

  for (const file of files) {
    assertSafePath(file.path);
    assertTextByteLimit(config, file.content, file.path);
  }

  for (const path of deletions) {
    assertSafePath(path);
  }

  const baseRef = await getBranchRef(config, input.owner, input.repo, input.branch);
  const baseSha = baseRef.object.sha;

  if (input.expected_base_sha && input.expected_base_sha !== baseSha) {
    throw new Error(
      `Branch moved: expected base ${input.expected_base_sha}, current base is ${baseSha}`
    );
  }

  const baseCommit = await githubFetch<GitHubCommitResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/commits/${baseSha}`
  );

  const treeEntries: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string | null;
  }> = [];

  for (const file of files) {
    const blob = await githubFetch<GitHubBlobResponse>(
      config,
      `/repos/${input.owner}/${input.repo}/git/blobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: Buffer.from(file.content, "utf8").toString("base64"),
          encoding: "base64"
        })
      }
    );

    treeEntries.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha
    });
  }

  for (const path of deletions) {
    treeEntries.push({
      path,
      mode: "100644",
      type: "blob",
      sha: null
    });
  }

  const newTree = await githubFetch<GitHubTreeCreateResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeEntries
      })
    }
  );

  const newCommit = await githubFetch<GitHubCommitResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        tree: newTree.sha,
        parents: [baseSha]
      })
    }
  );

  await githubFetch<GitHubRefResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/refs/heads/${toGitHubRefPath(input.branch)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sha: newCommit.sha,
        force: false
      })
    }
  );

  return {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    base_sha: baseSha,
    commit_sha: newCommit.sha,
    tree_sha: newTree.sha,
    files: files.map((file) => file.path),
    deletions,
    html_url: newCommit.html_url
  };
}

export async function githubDeleteFile(config: AppConfig, input: GitHubDeleteFileInput) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);
  assertWritableBranch(config, input.branch);

  const existingSha = await tryGetFileSha(
    config,
    input.owner,
    input.repo,
    input.path,
    input.branch
  );

  if (!existingSha) {
    throw new Error(`File does not exist on ${input.branch}: ${input.path}`);
  }

  const result = await githubFetch<GitHubUpsertResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/contents/${toGitHubContentPath(input.path)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        sha: existingSha,
        branch: input.branch
      })
    }
  );

  return {
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    branch: input.branch,
    deleted_sha: existingSha,
    commit_sha: result.commit?.sha,
    html_url: result.commit?.html_url
  };
}

export async function githubCreatePullRequest(config: AppConfig, input: GitHubPullRequestInput) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertWritableBranch(config, input.head);

  const pr = await githubFetch<GitHubPullResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/pulls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        head: input.head,
        base: input.base || config.githubDefaultBaseBranch,
        body: input.body || "",
        draft: input.draft ?? false,
        maintainer_can_modify: true
      })
    }
  );

  return {
    number: pr.number,
    html_url: pr.html_url,
    state: pr.state,
    title: pr.title,
    head: pr.head,
    base: pr.base
  };
}

export async function githubMergePullRequest(config: AppConfig, input: GitHubMergePullRequestInput) {
  assertAllowedRepo(config, input.owner, input.repo);

  const merge = await githubFetch<GitHubMergePullResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/pulls/${input.pr_number}/merge`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commit_title: input.commit_title,
        commit_message: input.commit_message,
        merge_method: input.merge_method || "squash"
      })
    }
  );

  return {
    owner: input.owner,
    repo: input.repo,
    pr_number: input.pr_number,
    ...merge
  };
}

export async function githubMarkPullRequestReadyForReview(
  config: AppConfig,
  input: GitHubMarkPullRequestReadyInput
) {
  assertAllowedRepo(config, input.owner, input.repo);

  const pr = await githubFetch<GitHubPullResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/pulls/${input.pr_number}`
  );

  if (!pr.node_id) {
    throw new Error(`Pull request node_id is missing: ${input.owner}/${input.repo}#${input.pr_number}`);
  }

  type MarkReadyResult = {
    markPullRequestReadyForReview: {
      pullRequest: {
        number: number;
        isDraft: boolean;
        url: string;
      };
    };
  };

  const data = await githubGraphqlFetch<MarkReadyResult>(
    config,
    `mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
      markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
        pullRequest { number isDraft url }
      }
    }`,
    { pullRequestId: pr.node_id }
  );

  return {
    ok: true,
    owner: input.owner,
    repo: input.repo,
    pr_number: data.markPullRequestReadyForReview.pullRequest.number,
    html_url: data.markPullRequestReadyForReview.pullRequest.url,
    ready_for_review: !data.markPullRequestReadyForReview.pullRequest.isDraft
  };
}

export async function githubClosePullRequest(config: AppConfig, input: GitHubClosePullRequestInput) {
  assertAllowedRepo(config, input.owner, input.repo);

  const pr = await githubFetch<GitHubPullResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/pulls/${input.pr_number}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "closed" })
    }
  );

  return {
    number: pr.number,
    html_url: pr.html_url,
    state: pr.state,
    title: pr.title,
    head: pr.head,
    base: pr.base
  };
}

export async function githubForceUpdateBranch(config: AppConfig, input: GitHubForceUpdateBranchInput) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertWritableBranch(config, input.branch);
  assertCommitSha(input.sha);

  if (input.expected_current_sha) {
    assertCommitSha(input.expected_current_sha, "expected_current_sha");
  }

  const currentRef = await getBranchRef(config, input.owner, input.repo, input.branch);
  const currentSha = currentRef.object.sha;

  if (input.expected_current_sha && input.expected_current_sha !== currentSha) {
    throw new Error(
      `Branch moved: expected current ${input.expected_current_sha}, actual current is ${currentSha}`
    );
  }

  const nextRef = await githubFetch<GitHubRefResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/refs/heads/${toGitHubRefPath(input.branch)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sha: input.sha,
        force: true
      })
    }
  );

  return {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    previous_sha: currentSha,
    sha: nextRef.object.sha,
    forced: true
  };
}

export async function githubDispatchWorkflow(config: AppConfig, input: GitHubWorkflowDispatchInput) {
  assertAllowedRepo(config, input.owner, input.repo);

  await githubFetchNoContent(
    config,
    `/repos/${input.owner}/${input.repo}/actions/workflows/${encodeURIComponent(
      String(input.workflow_id)
    )}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: input.ref,
        inputs: input.inputs ?? {}
      })
    }
  );

  return {
    ok: true,
    owner: input.owner,
    repo: input.repo,
    workflow_id: input.workflow_id,
    ref: input.ref,
    dispatched: true
  };
}

export async function githubGetWorkflowRuns(
  config: AppConfig,
  input: GitHubRepoRef & { branch?: string; per_page?: number }
) {
  assertAllowedRepo(config, input.owner, input.repo);

  const params = new URLSearchParams();
  params.set("per_page", String(Math.min(Math.max(input.per_page ?? 10, 1), 30)));
  if (input.branch) params.set("branch", input.branch);

  return githubFetch<GitHubWorkflowRunsResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/actions/runs?${params.toString()}`
  );
}

export async function githubListWorkflowRunArtifacts(
  config: AppConfig,
  input: GitHubRepoRef & { run_id: number; per_page?: number }
) {
  assertAllowedRepo(config, input.owner, input.repo);

  const params = new URLSearchParams();
  params.set("per_page", String(Math.min(Math.max(input.per_page ?? 30, 1), 100)));

  return githubFetch<GitHubArtifactsResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/actions/runs/${input.run_id}/artifacts?${params.toString()}`
  );
}

export async function githubDownloadWorkflowArtifactZip(
  config: AppConfig,
  input: GitHubRepoRef & { artifact_id: number }
): Promise<GitHubBinaryResult> {
  assertAllowedRepo(config, input.owner, input.repo);

  const result = await githubFetchBinary(
    config,
    `/repos/${input.owner}/${input.repo}/actions/artifacts/${input.artifact_id}/zip`,
    `${input.repo}-artifact-${input.artifact_id}.zip`
  );

  return {
    owner: input.owner,
    repo: input.repo,
    ...result
  };
}

export async function githubDownloadArchiveZip(
  config: AppConfig,
  input: GitHubRepoRef & { ref?: string }
): Promise<GitHubBinaryResult> {
  assertAllowedRepo(config, input.owner, input.repo);

  const ref = input.ref || config.githubDefaultBaseBranch;
  const result = await githubFetchBinary(
    config,
    `/repos/${input.owner}/${input.repo}/zipball/${encodeURIComponent(ref)}`,
    `${input.repo}-${safeFileName(ref)}.zip`
  );

  return {
    owner: input.owner,
    repo: input.repo,
    ...result
  };
}

export async function githubCommentPullRequest(
  config: AppConfig,
  input: GitHubRepoRef & { pr_number: number; body: string }
) {
  assertAllowedRepo(config, input.owner, input.repo);

  const comment = await githubFetch<{ id: number; html_url: string; body: string }>(
    config,
    `/repos/${input.owner}/${input.repo}/issues/${input.pr_number}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: input.body })
    }
  );

  return {
    id: comment.id,
    html_url: comment.html_url,
    body: comment.body
  };
}
