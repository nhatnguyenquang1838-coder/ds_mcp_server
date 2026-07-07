import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { writeAuditEvent } from "./auditLog.js";

type GitHubRepoRef = {
  owner: string;
  repo: string;
};

type GitHubErrorBody = {
  message?: string;
};

type GitHubContentResponse = {
  type: string;
  encoding?: string;
  content?: string;
  sha?: string;
  path?: string;
  html_url?: string;
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

type PushFileInput = GitHubRepoRef & {
  path: string;
  branch: string;
  message: string;
  content?: string;
  content_base64?: string;
};

type TextReplacement = {
  old_text: string;
  new_text: string;
  replace_all?: boolean;
};

type ReplaceInFileInput = GitHubRepoRef & {
  path: string;
  branch: string;
  message: string;
  expected_sha?: string;
  replacements: TextReplacement[];
};

type TextContent = { type: "text"; text: string };
type ToolTextResult = {
  structuredContent: Record<string, unknown>;
  content: TextContent[];
};

function toStructuredContent(output: unknown): Record<string, unknown> {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }

  return { value: output };
}

function textOutput(output: unknown): ToolTextResult {
  return {
    structuredContent: toStructuredContent(output),
    content: [{ type: "text", text: JSON.stringify(output) }]
  };
}

function requireGitHubToken(config: AppConfig): string {
  if (!config.githubToken) throw new Error("GITHUB_TOKEN is not configured");
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
    throw new Error(`Branch must start with one of: ${config.githubAllowedBranchPrefixes.join(", ")}`);
  }
}

function decodeUtf8File(file: GitHubContentResponse, path: string): string {
  if (file.type !== "file" || file.encoding !== "base64" || !file.content) {
    throw new Error(`Path is not a UTF-8 file: ${path}`);
  }
  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function githubFetch<T>(config: AppConfig, path: string, init: RequestInit = {}): Promise<T> {
  const token = requireGitHubToken(config);
  const authHeader = ["Bearer", token].join(" ");
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: authHeader,
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

async function readGithubTextFile(
  config: AppConfig,
  input: GitHubRepoRef & { path: string; ref: string }
): Promise<{ sha?: string; content: string; html_url?: string }> {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);

  const file = await githubFetch<GitHubContentResponse>(
    config,
    `/repos/${input.owner}/${input.repo}/contents/${toGitHubContentPath(input.path)}?ref=${encodeURIComponent(input.ref)}`
  );

  return {
    sha: file.sha,
    content: decodeUtf8File(file, input.path),
    html_url: file.html_url
  };
}

async function getExistingFileSha(
  config: AppConfig,
  input: GitHubRepoRef & { path: string; branch: string }
): Promise<string | undefined> {
  try {
    const file = await githubFetch<GitHubContentResponse>(
      config,
      `/repos/${input.owner}/${input.repo}/contents/${toGitHubContentPath(input.path)}?ref=${encodeURIComponent(input.branch)}`
    );
    return file.sha;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) return undefined;
    throw error;
  }
}

async function commitContentBase64(
  config: AppConfig,
  input: GitHubRepoRef & {
    path: string;
    branch: string;
    message: string;
    content_base64: string;
    sha?: string;
  }
) {
  assertAllowedRepo(config, input.owner, input.repo);
  assertSafePath(input.path);
  assertWritableBranch(config, input.branch);

  const payload: Record<string, unknown> = {
    message: input.message,
    content: input.content_base64.replace(/\s/g, ""),
    branch: input.branch
  };

  if (input.sha) payload.sha = input.sha;

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

export async function githubPushFileFromMcp(config: AppConfig, input: PushFileInput) {
  if (Boolean(input.content) === Boolean(input.content_base64)) {
    throw new Error("Provide exactly one of content or content_base64");
  }

  const existingSha = await getExistingFileSha(config, input);
  const contentBase64 = input.content_base64 ?? Buffer.from(input.content ?? "", "utf8").toString("base64");

  return commitContentBase64(config, {
    ...input,
    content_base64: contentBase64,
    sha: existingSha
  });
}

function applyReplacement(content: string, replacement: TextReplacement): { content: string; count: number } {
  if (!replacement.old_text) throw new Error("old_text must not be empty");

  const count = content.split(replacement.old_text).length - 1;
  if (count === 0) throw new Error("old_text not found in target file");

  if (replacement.replace_all) {
    return {
      content: content.split(replacement.old_text).join(replacement.new_text),
      count
    };
  }

  return {
    content: content.replace(replacement.old_text, replacement.new_text),
    count: 1
  };
}

export async function githubReplaceInFileFromMcp(config: AppConfig, input: ReplaceInFileInput) {
  if (input.replacements.length === 0) throw new Error("At least one replacement is required");

  const existing = await readGithubTextFile(config, {
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    ref: input.branch
  });

  if (input.expected_sha && existing.sha !== input.expected_sha) {
    throw new Error(`File SHA mismatch. Expected ${input.expected_sha}, got ${existing.sha ?? "unknown"}`);
  }

  let nextContent = existing.content;
  const counts: number[] = [];

  for (const replacement of input.replacements) {
    const result = applyReplacement(nextContent, replacement);
    nextContent = result.content;
    counts.push(result.count);
  }

  const output = await commitContentBase64(config, {
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    branch: input.branch,
    message: input.message,
    content_base64: Buffer.from(nextContent, "utf8").toString("base64"),
    sha: existing.sha
  });

  return {
    ...output,
    replacements_applied: counts.reduce((sum, count) => sum + count, 0),
    replacement_counts: counts,
    previous_sha: existing.sha
  };
}

export function registerGitHubFilePushTools(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "github_push_file",
    {
      title: "Push file to GitHub",
      description:
        "Create or replace a file from GPT-provided text or base64 content on a guarded non-main branch. Use for new/generated files; for large existing files prefer github_replace_in_file.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        path: z.string().min(1),
        branch: z.string().min(1),
        message: z.string().min(1),
        content: z.string().optional(),
        content_base64: z.string().optional()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubPushFileFromMcp(config, input);
      writeAuditEvent({
        action: "github_push_file",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        branch: input.branch,
        path: input.path,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_replace_in_file",
    {
      title: "Replace text in GitHub file",
      description:
        "Read an existing UTF-8 file server-side, apply exact old_text/new_text replacements, and commit the result. Use this for large files to avoid sending full-file content through GPT/MCP.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        path: z.string().min(1),
        branch: z.string().min(1),
        message: z.string().min(1),
        expected_sha: z.string().optional(),
        replacements: z.array(
          z.object({
            old_text: z.string().min(1),
            new_text: z.string(),
            replace_all: z.boolean().optional()
          })
        ).min(1)
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubReplaceInFileFromMcp(config, input);
      writeAuditEvent({
        action: "github_replace_in_file",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        branch: input.branch,
        path: input.path,
        status: "success"
      });
      return textOutput(output);
    }
  );
}
