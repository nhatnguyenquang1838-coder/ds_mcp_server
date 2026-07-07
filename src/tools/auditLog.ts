export type AuditAction =
  | "ds_submit_agent_result"
  | "github_create_branch"
  | "github_upsert_file"
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
  | "workspace_agent_trigger"
  | "workspace_agent_callback";

export type AuditEvent = {
  action: AuditAction;
  source: "mcp" | "rest" | "github-client" | "workspace-agent";
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
  pr_number?: number;
  request_id?: string;
  run_id?: string;
  status: "success" | "failure";
  message?: string;
  timestamp?: string;
};

export function writeAuditEvent(event: AuditEvent): void {
  const payload = {
    level: "audit",
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...event
  };

  console.info(JSON.stringify(payload));
}
