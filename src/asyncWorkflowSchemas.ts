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
