import { z } from "zod";

export const asyncTaskTypeSchema = z.enum([
  "analyze_repo",
  "plan_changes",
  "modify_code",
  "create_pr",
  "wait_github_ci",
  "fix_ci",
  "final_report"
]);

export const createAsyncWorkflowSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["web", "chatgpt", "system"]).default("web"),
  input: z.record(z.unknown()).default({}),
  first_task_type: asyncTaskTypeSchema.default("analyze_repo")
});

export const updateAsyncWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  input: z.record(z.unknown()).optional()
}).refine((input) => Object.keys(input).length > 0, {
  message: "At least one workflow field is required"
});

export const bulkAddAsyncWorkflowTasksSchema = z.object({
  tasks: z.array(z.object({
    type: asyncTaskTypeSchema,
    payload_json: z.record(z.unknown()).default({}),
    parent_task_id: z.string().min(1).optional(),
    status: z.enum(["queued", "waiting_external"]).default("queued"),
    wait_key: z.string().min(1).optional()
  })).min(1).max(100)
});

export const bulkRemoveAsyncWorkflowTasksSchema = z.object({
  task_ids: z.array(z.string().min(1)).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "Task IDs must be unique" }
  )
});

export const claimAsyncTaskSchema = z.object({
  agent_id: z.string().min(1),
  capabilities: z.array(asyncTaskTypeSchema).min(1),
  lease_seconds: z.number().int().positive().max(900).default(120),
  task_id: z.string().min(1).optional(),
  workflow_id: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  repo_owner: z.string().min(1).optional(),
  repo_name: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  repo_branch: z.string().min(1).optional(),
  pr_number: z.number().int().positive().optional()
});

export const submitAsyncTaskResultSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  summary: z.string().min(1).optional(),
  artifacts: z.record(z.unknown()).default({}),
  error: z.record(z.unknown()).optional()
});

export const githubCiEventSchema = z.object({
  delivery_id: z.string().min(1),
  repo: z.string().optional(),
  pr_number: z.number().int().positive().optional(),
  head_sha: z.string().optional(),
  conclusion: z.string().optional()
});
