import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { forwardAgentResultToBackend } from "./tools/backendClient.js";
import { getDesignRequest, submitAgentResult } from "./tools/designSystemStore.js";

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: "design-system-mcp",
    version: "0.1.0"
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
        version: "0.1.0"
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

  return server;
}
