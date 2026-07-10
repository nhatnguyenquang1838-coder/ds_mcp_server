import { redactValue } from "../security/redaction.js";

export type AuditAction =
  | "ds_submit_agent_result"
  | "github_create_branch"
  | "github_upsert_file"
  | "github_push_file"
  | "github_replace_in_file"
  | "github_apply_text_patch"
  | "github_push_file"
  | "github_replace_in_file"
  | "github_commit_files"
  | "github_delete_file"
  | "github_create_pr"
  | "github_merge_pr"
  | "github_close_pr"
  | "github_dispatch_workflow"
  | "github_comment_pr"
  | "github_create_upload_session"
  | "github_complete_upload_session"
  | "github_commit_upload_session"
  | "workspace_agent_trigger"
  | "workspace_agent_callback"
  | "security_auth_denied"
  | "security_rate_limited"
  | "security_startup_validation";

export type AuditEvent = {
  action: AuditAction;
  source: "mcp" | "rest" | "github-client" | "workspace-agent";
  route_id?: string;
  principal_type?: string;
  principal_id?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
  pr_number?: number;
  request_id?: string;
  run_id?: string;
  status: "success" | "failure";
  message?: string;
  reason?: string;
  target?: Record<string, string>;
  timestamp?: string;
};

export function writeAuditEvent(event: AuditEvent): void {
  const payload = redactValue({
    level: "audit",
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...event
  });

  console.info(JSON.stringify(payload));
}
