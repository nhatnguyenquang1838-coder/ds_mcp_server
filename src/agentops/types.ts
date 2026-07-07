export type TaskType =
  | "epic"
  | "story"
  | "task"
  | "bug"
  | "spec"
  | "design_review"
  | "implementation"
  | "validation"
  | "approval";

export type TaskState =
  | "draft"
  | "ready"
  | "blocked"
  | "agent_running"
  | "pending_review"
  | "pending_approval"
  | "write_running"
  | "validation_running"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TaskLinkType =
  | "parent_child"
  | "blocks"
  | "depends_on"
  | "relates_to"
  | "duplicates"
  | "derived_from"
  | "implements"
  | "validates";

export type TaskTransition =
  | "SUBMIT"
  | "RUN_AGENT"
  | "BLOCK"
  | "UNBLOCK"
  | "CALLBACK_SUCCESS"
  | "CALLBACK_FAILED"
  | "APPROVE_PLAN"
  | "REVISE"
  | "APPROVE_WRITE"
  | "REJECT_WRITE"
  | "PR_CREATED"
  | "VALIDATION_PASSED"
  | "VALIDATION_FAILED"
  | "CANCEL";

export type TaskRecord = {
  id: string;
  title: string;
  description?: string | null;
  task_type: TaskType;
  source: "manual" | "design_request" | "github" | "agent" | "system";
  source_ref?: string | null;
  state: TaskState;
  priority: TaskPriority;
  parent_task_id?: string | null;
  root_task_id?: string | null;
  assigned_agent_id?: string | null;
  owner_user_id?: string | null;
  latest_run_id?: string | null;
  run_count: number;
  repo_owner?: string | null;
  repo_name?: string | null;
  repo_branch?: string | null;
  pr_number?: number | null;
  pr_url?: string | null;
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

export type TaskLinkRecord = {
  id: string;
  from_task_id: string;
  to_task_id: string;
  link_type: TaskLinkType;
  status: "active" | "inactive";
  created_by?: string | null;
  created_at: string;
};

export type TaskEventRecord = {
  id: string;
  task_id: string;
  run_id?: string | null;
  event_type:
    | "task_created"
    | "task_updated"
    | "state_changed"
    | "link_created"
    | "link_removed"
    | "agent_triggered"
    | "agent_callback_received"
    | "approval_requested"
    | "approval_approved"
    | "approval_rejected"
    | "github_pr_created"
    | "validation_completed";
  from_state?: TaskState | null;
  to_state?: TaskState | null;
  actor: "user" | "agent" | "system";
  actor_id?: string | null;
  idempotency_key?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
};
