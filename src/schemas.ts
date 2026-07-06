import { z } from "zod";

export const frontendTaskSchema = z.object({
  title: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1)
});

export const agentResultSchema = z.object({
  request_id: z.string().min(1),
  decision: z.enum(["approve", "revise", "reject"]),
  summary: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]),
  frontend_tasks: z.array(frontendTaskSchema).min(1),
  validation: z.array(z.string().min(1)).min(1)
});

export const githubCreateBranchSchema = z.object({
  branch: z.string().min(1),
  from_branch: z.string().min(1).optional()
});

export const githubUpsertFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  branch: z.string().min(1),
  message: z.string().min(1)
});

export const githubApplyTextPatchSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  message: z.string().min(1),
  old_text: z.string().min(1),
  new_text: z.string(),
  expected_replacements: z.number().int().positive().optional(),
  replace_all: z.boolean().optional()
});

export const githubCommitFilesSchema = z.object({
  branch: z.string().min(1),
  message: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string()
      })
    )
    .optional(),
  deletions: z.array(z.string().min(1)).optional(),
  expected_base_sha: z.string().min(1).optional()
});

export const githubDeleteFileSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  message: z.string().min(1)
});

export const githubCreatePullRequestSchema = z.object({
  title: z.string().min(1),
  head: z.string().min(1),
  base: z.string().min(1).optional(),
  body: z.string().optional(),
  draft: z.boolean().optional()
});

export const githubMergePullRequestSchema = z.object({
  commit_title: z.string().min(1).optional(),
  commit_message: z.string().optional(),
  merge_method: z.enum(["merge", "squash", "rebase"]).optional()
});

export const githubCommentPullRequestSchema = z.object({
  body: z.string().min(1)
});

export const githubDispatchWorkflowSchema = z.object({
  workflow_id: z.union([z.string().min(1), z.number().int().positive()]),
  ref: z.string().min(1),
  inputs: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

export const workspaceAgentRunTriggerSchema = z.object({
  agent_type: z.string().min(1).default("design_review"),
  request_id: z.string().min(1),
  mode: z.enum(["review_only", "create_pr"]).default("review_only"),
  input: z.string().optional()
});

export const workspaceAgentRunResultSchema = z.object({
  status: z.enum(["completed", "failed"]),
  decision: z.enum(["approve", "revise", "reject", "unknown"]).optional(),
  risk_level: z.enum(["low", "medium", "high", "unknown"]).optional(),
  summary: z.string().min(1),
  validation: z.array(z.string()).optional(),
  error: z.string().optional()
});

export type AgentResultInput = z.infer<typeof agentResultSchema>;
export type WorkspaceAgentRunTriggerInput = z.infer<typeof workspaceAgentRunTriggerSchema>;
export type WorkspaceAgentRunResultInput = z.infer<typeof workspaceAgentRunResultSchema>;
