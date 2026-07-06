import type { AppConfig } from "../config.js";
import type { AgentResult } from "../types.js";

export async function forwardAgentResultToBackend(
  config: AppConfig,
  result: AgentResult
): Promise<{ forwarded: boolean; status?: number }> {
  if (!config.designSystemBackendUrl || !config.internalAgentResultToken) {
    return { forwarded: false };
  }

  const url = new URL("/internal/agent-results", config.designSystemBackendUrl);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": config.internalAgentResultToken
    },
    body: JSON.stringify(result)
  });

  if (!response.ok) {
    return { forwarded: false, status: response.status };
  }

  return { forwarded: true, status: response.status };
}
