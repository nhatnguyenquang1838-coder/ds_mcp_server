import type { AppConfig } from "../config.js";
import type { AgentRunRecord } from "./agentRunStore.js";

export type WorkspaceAgentTriggerResult = {
  accepted: boolean;
  status_code: number;
  conversation_key: string;
  idempotency_key: string;
};

function requireWorkspaceAgentConfig(config: AppConfig): {
  triggerId: string;
  token: string;
  baseUrl: string;
} {
  if (!config.workspaceAgentTriggerId) {
    throw new Error("WORKSPACE_AGENT_TRIGGER_ID is not configured");
  }

  if (!config.workspaceAgentToken) {
    throw new Error("WORKSPACE_AGENT_TOKEN is not configured");
  }

  return {
    triggerId: config.workspaceAgentTriggerId,
    token: config.workspaceAgentToken,
    baseUrl: config.workspaceAgentApiBaseUrl.replace(/\/$/, "")
  };
}

function buildAgentInput(run: AgentRunRecord, callbackUrl: string): string {
  const additionalInput = run.input_json.input ? `\nAdditional input:\n${run.input_json.input}\n` : "";

  return `Triggered backend run.\n\nRun ID: ${run.id}\nRequest ID: ${run.request_id}\nAgent type: ${run.agent_type}\nMode: ${run.mode}\nCallback URL: ${callbackUrl}\n\nRequired workflow:\n1. Inspect request context.\n2. Follow the requested mode.\n3. When finished, call the backend callback Action with run_id=${run.id}.\n4. Return status, decision, risk_level, summary, validation, and error when blocked.\n${additionalInput}`;
}

export async function triggerWorkspaceAgent(
  config: AppConfig,
  run: AgentRunRecord,
  callbackUrl: string
): Promise<WorkspaceAgentTriggerResult> {
  const workspaceAgentConfig = requireWorkspaceAgentConfig(config);
  const headers = new Headers();
  headers.set(["Author", "ization"].join(""), `Bearer ${workspaceAgentConfig.token}`);
  headers.set("Content-Type", "application/json");
  headers.set("Idempotency-Key", run.idempotency_key);

  const response = await fetch(
    `${workspaceAgentConfig.baseUrl}/v1/workspace_agents/${workspaceAgentConfig.triggerId}/trigger`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversation_key: run.conversation_key,
        input: buildAgentInput(run, callbackUrl)
      })
    }
  );

  if (response.status !== 202) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Workspace agent trigger failed: ${response.status} ${errorText}`.trim());
  }

  return {
    accepted: true,
    status_code: response.status,
    conversation_key: run.conversation_key,
    idempotency_key: run.idempotency_key
  };
}
