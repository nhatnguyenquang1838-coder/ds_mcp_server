import type { AppConfig } from "../config.js";
import { githubReadFile, githubUpsertFile, type GitHubRepoRef } from "./githubClient.js";

export type GitHubBinaryFileResult = GitHubRepoRef & {
  path: string;
  ref?: string;
  sha?: string;
  size?: number;
  encoding: "base64";
  content_base64: string;
  html_url?: string;
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

export type GitHubMergePullRequestInput = GitHubRepoRef & {
  pr_number: number;
  commit_title?: string;
  commit_message?: string;
  merge_method?: "merge" | "squash" | "rebase";
};

export type GitHubClosePullRequestInput = GitHubRepoRef & {
  pr_number: number;
};

export type GitHubWorkflowDispatchInput = GitHubRepoRef & {
  workflow_id: string | number;
  ref: string;
  inputs?: Record<string, string | number | boolean>;
};

type GitHubErrorBody = { message?: string };

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
  object: { sha: string; type: string; url: string };
};

type GitHubCommitResponse = {
  sha: string;
  html_url?: string;
  tree: { sha: string; url: string };
};

type GitHubBlobResponse = { sha: string; url: string };

type GitHubTreeResponse = {
  sha: string;
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
};

type GitHubPullResponse = {
  number: number;
  html_url: string;
  state: string;
  title: string;
  head: { ref: string; sha: string };
  base: { ref: string };
};

type GitHubMergePullResponse = {
  sha: string;
  merged: boolean;
  message: string;
};

function requireGitHubToken(config: AppConfig): string {
  if (!config.githubToken) throw new Error("GITHUB_TOKEN is not configured");
  return config.githubToken;
}

function assertAllowedRepo(config: AppConfig, owner: string, repo: string): void {
  const fullName = `${owner}/${repo}`;
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

function toContentPath(path: string): string {
  assertSafePath(path);
  return path.split("/").map(encodeURIComponent).join("/");
}

function toRefPath(branch: string): string {
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

function assertTextByteLimit(config: AppConfig, content: string, path: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > config.githubMaxFileBytes) {
    throw new Error(
      `File exceeds GITHUB_MAX_FILE_BYTES: ${path} is ${bytes} bytes, limit is ${config.githubMaxFileBytes}`
    );
  }
}

function countOccurrences(text: string, needle: string): number {
  return needle ? text.split(needle).length - 1 : 0;
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
      // keep generic message
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
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
      // keep generic message
    }
    throw new Error(message);
  }
}

async function getBranchRef(
  config: AppConfig,
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubRefResponse> {
  return githubFetch<GitHubRefResponse>(
    config,
    `/repos/${owner}/${repo}/git/ref/heads/${toRefPath(branch)}`
  );
}

async function resolveCommitSha(
  config: AppConfig,
  owner: string,
  repo: string,
  ref: string
): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
  const branch = await getBranchRef(config, owner, repo, ref);
  return branch.object.sha;
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
    `/repos/${input.owner}/${input.repo}/contents/${toContentPath(input.path)}${query}`
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
    tree: tree.tree
  };
}

export async function githubApplyTextPatch(
  config: AppConfig,
  input: GitHubApplyTextPatchInput
) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);
  assertWritableBranch(config, input.branch);

  if (!input.old_text) throw new Error("old_text must not be empty");

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

  return { ...output, previous_sha: current.sha, replacements: actual };
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
  for (const path of deletions) assertSafePath(path);

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
    treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  for (const path of deletions) {
    treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  const newTree = await githubFetch<GitHubTreeCreateResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries })
    }
  );

  const newCommit = await githubFetch<GitHubCommitResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input.message, tree: newTree.sha, parents: [baseSha] })
    }
  );

  await githubFetch<GitHubRefResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/refs/heads/${toRefPath(input.branch)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommit.sha })
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
  return githubCommitFiles(config, {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    message: input.message,
    deletions: [input.path]
  });
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

  return { owner: input.owner, repo: input.repo, pr_number: input.pr_number, ...merge };
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
      body: JSON.stringify({ ref: input.ref, inputs: input.inputs ?? {} })
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
