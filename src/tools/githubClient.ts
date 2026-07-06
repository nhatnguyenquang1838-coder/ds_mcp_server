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

export type GitHubPullRequestInput = GitHubRepoRef & {
  title: string;
  head: string;
  base?: string;
  body?: string;
  draft?: boolean;
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
};

type GitHubRefResponse = {
  ref: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
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
  html_url: string;
  state: string;
  title: string;
  head: { ref: string; sha: string };
  base: { ref: string };
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

export async function githubCreateBranch(
  config: AppConfig,
  input: GitHubRepoRef & { branch: string; from_branch?: string }
): Promise<GitHubBranchResult> {
  assertAllowedRepo(config, input.owner, input.repo);
  assertWritableBranch(config, input.branch);

  const fromBranch = input.from_branch || config.githubDefaultBaseBranch;
  const baseRef = await githubFetch<GitHubRefResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/git/ref/heads/${encodeURIComponent(fromBranch)}`
  );

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
