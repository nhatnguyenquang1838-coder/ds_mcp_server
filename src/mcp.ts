import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { forwardAgentResultToBackend } from "./tools/backendClient.js";
import { getDesignRequest, submitAgentResult } from "./tools/designSystemStore.js";
import {
  githubCommentPullRequest,
  githubCreateBranch,
  githubCreatePullRequest,
  githubDownloadArchiveZip,
  githubDownloadWorkflowArtifactZip,
  githubGetRepo,
  githubGetWorkflowRuns,
  githubListWorkflowRunArtifacts,
  githubReadFile,
  githubUpsertFile,
  type GitHubBinaryResult
} from "./tools/githubClient.js";
import {
  githubApplyTextPatch,
  githubClosePullRequest,
  githubCommitFiles,
  githubDeleteFile,
  githubDispatchWorkflow,
  githubListTree,
  githubMergePullRequest,
  githubReadBinaryFile
} from "./tools/githubAdvancedClient.js";
import { writeAuditEvent } from "./tools/auditLog.js";

const serviceVersion = "0.7.0";

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

function binaryOutput(output: GitHubBinaryResult): ToolTextResult {
  const structured = {
    owner: output.owner,
    repo: output.repo,
    file_name: output.file_name,
    content_type: output.content_type,
    size_bytes: output.content.byteLength,
    encoding: "base64",
    content_base64: output.content.toString("base64")
  };

  return {
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(structured) }]
  };
}

function textOutput(output: unknown): ToolTextResult {
  const structured = toStructuredContent(output);

  return {
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(output) }]
  };
}

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: "design-system-mcp",
    version: serviceVersion
  });

  server.registerTool(
    "ds_ping",
    {
      title: "Ping Design System MCP",
      description: "Health check for the Design System MCP server.",
      inputSchema: {},
      outputSchema: {
        ok: z.boolean(),
        service: z.string(),
        version: z.string()
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async () => {
      const output = {
        ok: true,
        service: "design-system-mcp",
        version: serviceVersion
      };

      return textOutput(output);
    }
  );

  server.registerTool(
    "ds_get_request",
    {
      title: "Get design request",
      description:
        "Fetch a design system request by request_id. Call this before reviewing or submitting a result.",
      inputSchema: {
        request_id: z.string().min(1)
      },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        project: z.string(),
        status: z.string(),
        requirement: z.string(),
        figmaUrl: z.string().optional(),
        githubUrl: z.string().optional()
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ request_id }) => textOutput(await getDesignRequest(request_id))
  );

  server.registerTool(
    "ds_submit_agent_result",
    {
      title: "Submit agent result",
      description:
        "Submit the final AI review result back to the Design System backend. This is a write action.",
      inputSchema: {
        request_id: z.string().min(1),
        decision: z.enum(["approve", "revise", "reject"]),
        summary: z.string().min(1),
        risk_level: z.enum(["low", "medium", "high"]),
        frontend_tasks: z.array(
          z.object({
            title: z.string().min(1),
            acceptance_criteria: z.array(z.string().min(1)).min(1)
          })
        ),
        validation: z.array(z.string().min(1)).min(1)
      },
      outputSchema: {
        ok: z.boolean(),
        request_id: z.string(),
        stored: z.boolean(),
        forwarded_to_backend: z.boolean(),
        backend_status: z.number().optional()
      },
      annotations: {
        readOnlyHint: false
      }
    },
    async (input) => {
      await submitAgentResult(input);
      const forwardResult = await forwardAgentResultToBackend(config, input);
      const output = {
        ok: true,
        request_id: input.request_id,
        stored: true,
        forwarded_to_backend: forwardResult.forwarded,
        backend_status: forwardResult.status
      };
      writeAuditEvent({
        action: "ds_submit_agent_result",
        source: "mcp",
        request_id: input.request_id,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_get_repo",
    {
      title: "Get GitHub repository",
      description: "Get metadata for an allowlisted GitHub repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1)
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => textOutput(await githubGetRepo(config, input))
  );

  server.registerTool(
    "github_read_file",
    {
      title: "Read GitHub file",
      description: "Read a UTF-8 file from an allowlisted GitHub repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        path: z.string().min(1),
        ref: z.string().optional()
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => textOutput(await githubReadFile(config, input))
  );

  server.registerTool(
    "github_read_binary_file",
    {
      title: "Read GitHub binary file",
      description: "Read a file as base64 from an allowlisted GitHub repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        path: z.string().min(1),
        ref: z.string().optional()
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => textOutput(await githubReadBinaryFile(config, input))
  );

  server.registerTool(
    "github_list_tree",
    {
      title: "List GitHub repository tree",
      description: "List files and folders from a branch, tag, or commit in an allowlisted repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        ref: z.string().optional(),
        recursive: z.boolean().optional()
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => textOutput(await githubListTree(config, input))
  );

  server.registerTool(
    "github_create_branch",
    {
      title: "Create GitHub branch",
      description:
        "Create a guarded branch from the default base branch or a provided base branch. Branch must use an allowed prefix.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        branch: z.string().min(1),
        from_branch: z.string().optional()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubCreateBranch(config, input);
      writeAuditEvent({
        action: "github_create_branch",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        branch: output.branch,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_upsert_file",
    {
      title: "Create or update GitHub file",
      description:
        "Create or update a UTF-8 file on a guarded non-main branch. Always read existing content before using this tool.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
        branch: z.string().min(1),
        message: z.string().min(1)
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubUpsertFile(config, input);
      writeAuditEvent({
        action: "github_upsert_file",
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
    "github_apply_text_patch",
    {
      title: "Apply exact text patch to GitHub file",
      description:
        "Patch a UTF-8 file on a guarded branch by replacing an exact old_text block. Safer than sending a full large file from the client.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        path: z.string().min(1),
        branch: z.string().min(1),
        message: z.string().min(1),
        old_text: z.string().min(1),
        new_text: z.string(),
        expected_replacements: z.number().int().positive().optional(),
        replace_all: z.boolean().optional()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubApplyTextPatch(config, input);
      writeAuditEvent({
        action: "github_apply_text_patch",
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
    "github_commit_files",
    {
      title: "Commit multiple GitHub files",
      description:
        "Create one atomic commit on a guarded branch with multiple UTF-8 file updates and optional deletions.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        branch: z.string().min(1),
        message: z.string().min(1),
        files: z
          .array(
            z.object({
              path: z.string().min(1),
              content: z.string()
            })
          )
          .optional(),
        deletions: z.array(z.string().min(1)).optional(),
        expected_base_sha: z.string().optional()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubCommitFiles(config, input);
      writeAuditEvent({
        action: "github_commit_files",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        branch: input.branch,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_delete_file",
    {
      title: "Delete GitHub file",
      description: "Delete one file from a guarded non-main branch.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        path: z.string().min(1),
        branch: z.string().min(1),
        message: z.string().min(1)
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubDeleteFile(config, input);
      writeAuditEvent({
        action: "github_delete_file",
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
    "github_create_pr",
    {
      title: "Create GitHub pull request",
      description: "Create a pull request from a guarded branch to the default base branch.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        title: z.string().min(1),
        head: z.string().min(1),
        base: z.string().optional(),
        body: z.string().optional(),
        draft: z.boolean().optional()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubCreatePullRequest(config, input);
      writeAuditEvent({
        action: "github_create_pr",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        branch: input.head,
        pr_number: output.number,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_merge_pr",
    {
      title: "Merge GitHub pull request",
      description: "Merge a pull request in an allowlisted repository. Default merge method is squash.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        pr_number: z.number().int().positive(),
        commit_title: z.string().optional(),
        commit_message: z.string().optional(),
        merge_method: z.enum(["merge", "squash", "rebase"]).optional()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubMergePullRequest(config, input);
      writeAuditEvent({
        action: "github_merge_pr",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        pr_number: input.pr_number,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_close_pr",
    {
      title: "Close GitHub pull request",
      description: "Close a pull request without merging it.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        pr_number: z.number().int().positive()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubClosePullRequest(config, input);
      writeAuditEvent({
        action: "github_close_pr",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        pr_number: input.pr_number,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_dispatch_workflow",
    {
      title: "Dispatch GitHub Actions workflow",
      description:
        "Trigger a GitHub Actions workflow_dispatch run for tests or validation in an allowlisted repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        workflow_id: z.union([z.string().min(1), z.number().int().positive()]),
        ref: z.string().min(1),
        inputs: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubDispatchWorkflow(config, input);
      writeAuditEvent({
        action: "github_dispatch_workflow",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        status: "success"
      });
      return textOutput(output);
    }
  );

  server.registerTool(
    "github_get_workflow_runs",
    {
      title: "Get GitHub Actions workflow runs",
      description: "Get recent GitHub Actions workflow runs for an allowlisted repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        branch: z.string().optional(),
        per_page: z.number().int().min(1).max(30).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => textOutput(await githubGetWorkflowRuns(config, input))
  );

  server.registerTool(
    "github_list_workflow_run_artifacts",
    {
      title: "List GitHub Actions workflow run artifacts",
      description: "List artifacts for a specific GitHub Actions workflow run in an allowlisted repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        run_id: z.number().int().positive(),
        per_page: z.number().int().min(1).max(100).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => textOutput(await githubListWorkflowRunArtifacts(config, input))
  );

  server.registerTool(
    "github_download_workflow_artifact_zip",
    {
      title: "Download GitHub Actions artifact ZIP",
      description:
        "Download a GitHub Actions artifact ZIP from an allowlisted repository. Returns base64 content; prefer REST download endpoint for large artifacts.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        artifact_id: z.number().int().positive()
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => binaryOutput(await githubDownloadWorkflowArtifactZip(config, input))
  );

  server.registerTool(
    "github_download_repo_archive_zip",
    {
      title: "Download GitHub repository archive ZIP",
      description:
        "Download a repository archive ZIP for a branch, tag, or commit ref. Returns base64 content; prefer REST download endpoint for large archives.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        ref: z.string().optional()
      },
      annotations: { readOnlyHint: true }
    },
    async (input) => binaryOutput(await githubDownloadArchiveZip(config, input))
  );

  server.registerTool(
    "github_comment_pr",
    {
      title: "Comment on GitHub pull request",
      description: "Add a comment to a pull request in an allowlisted repository.",
      inputSchema: {
        owner: z.string().min(1),
        repo: z.string().min(1),
        pr_number: z.number().int().positive(),
        body: z.string().min(1)
      },
      annotations: { readOnlyHint: false }
    },
    async (input) => {
      const output = await githubCommentPullRequest(config, input);
      writeAuditEvent({
        action: "github_comment_pr",
        source: "mcp",
        owner: input.owner,
        repo: input.repo,
        pr_number: input.pr_number,
        status: "success"
      });
      return textOutput(output);
    }
  );

  return server;
}
