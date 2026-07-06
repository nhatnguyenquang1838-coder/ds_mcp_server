import { randomUUID } from "node:crypto";
import type {
  WorkspaceAgentRunResultInput,
  WorkspaceAgentRunTriggerInput
} from "../schemas.js";

export type AgentRunStatus =
  | "created"
  | "triggering"
  | "triggered"
  | "completed"
  | "failed";

export type AgentRunRecord = {
  id: string;
  agent_type: string;
  request_id: string;
  mode: "review_only" | "create_pr";
  conversation_key: string;
  idempotency_key: string;
  status: AgentRunStatus;
  input_json: WorkspaceAgentRunTriggerInput;
  result_json?: WorkspaceAgentRunResultInput;
  trigger_status_code?: number;
  trigger_error?: string;
  created_at: string;
  triggered_at?: string;
  completed_at?: string;
};

const agentRuns = new Map<string, AgentRunRecord>();

export function createAgentRun(input: WorkspaceAgentRunTriggerInput): AgentRunRecord {
  const id = `airun_${randomUUID()}`;
  const conversationKey = `${input.agent_type}:${input.request_id}`;

  const record: AgentRunRecord = {
    id,
    agent_type: input.agent_type,
    request_id: input.request_id,
    mode: input.mode,
    conversation_key: conversationKey,
    idempotency_key: id,
    status: "created",
    input_json: input,
    created_at: new Date().toISOString()
  };

  agentRuns.set(id, record);
  return record;
}

export function getAgentRun(id: string): AgentRunRecord | undefined {
  return agentRuns.get(id);
}

export function markAgentRunTriggering(id: string): AgentRunRecord | undefined {
  const record = agentRuns.get(id);
  if (!record) return undefined;
  record.status = "triggering";
  agentRuns.set(id, record);
  return record;
}

export function markAgentRunTriggered(id: string, statusCode: number): AgentRunRecord | undefined {
  const record = agentRuns.get(id);
  if (!record) return undefined;
  record.status = "triggered";
  record.trigger_status_code = statusCode;
  record.triggered_at = new Date().toISOString();
  agentRuns.set(id, record);
  return record;
}

export function markAgentRunFailed(id: string, error: string): AgentRunRecord | undefined {
  const record = agentRuns.get(id);
  if (!record) return undefined;
  record.status = "failed";
  record.trigger_error = error;
  record.completed_at = new Date().toISOString();
  agentRuns.set(id, record);
  return record;
}

export function completeAgentRun(
  id: string,
  result: WorkspaceAgentRunResultInput
): AgentRunRecord | undefined {
  const record = agentRuns.get(id);
  if (!record) return undefined;
  record.status = result.status === "failed" ? "failed" : "completed";
  record.result_json = result;
  record.completed_at = new Date().toISOString();
  agentRuns.set(id, record);
  return record;
}
