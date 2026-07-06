import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { forwardAgentResultToBackend } from "./tools/backendClient.js";
import { getDesignRequest, submitAgentResult } from "./tools/designSystemStore.js";
import {
  githubCommentPullRequest,
  githubCreateBranch,
  githubCreatePullRequest,
  githubGetRepo,
  githubGetWorkflowRuns,
  githubReadFile,
  githubUpsertFile
} from "./tools/githubClient.js";

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: "design-system-mcp",
    version: "0.2.0"
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
        version: "0.2.0"
      };

      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
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
    async ({ request_id }) => {
      const output = await getDesignRequest(request_id);

      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
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

      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
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
    async (input) => {
      const output = await githubGetRepo(config, input);
      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
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
    async (input) => {
      const output = await githubReadFile(config, input);
      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
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
      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
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
      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
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
      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
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
    async (input) => {
      const output = await githubGetWorkflowRuns(config, input);
      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
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
      return {
        structuredContent: output,
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
  );

  return server;
}
