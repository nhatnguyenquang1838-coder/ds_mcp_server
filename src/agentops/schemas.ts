import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  task_type: z.enum([
    "epic",
    "story",
    "task",
    "bug",
    "spec",
    "design_review",
    "implementation",
    "validation",
    "approval"
  ]).default("task"),
  source: z.enum(["manual", "design_request", "github", "agent", "system"]).default("manual"),
  source_ref: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  parent_task_id: z.string().optional(),
  assigned_agent_id: z.string().optional(),
  owner_user_id: z.string().optional(),
  repo_owner: z.string().optional(),
  repo_name: z.string().optional(),
  repo_branch: z.string().optional(),
  idempotency_key: z.string().min(1).max(200).optional()
});

export const updateTaskSchema = createTaskSchema.partial().omit({ parent_task_id: true });

export const createTaskLinkSchema = z.object({
  to_task_id: z.string().min(1),
  link_type: z.enum([
    "parent_child",
    "blocks",
    "depends_on",
    "relates_to",
    "duplicates",
    "derived_from",
    "implements",
    "validates"
  ]),
  created_by: z.string().optional(),
  idempotency_key: z.string().min(1).max(200).optional()
});

export const transitionTaskSchema = z.object({
  transition: z.enum([
    "SUBMIT",
    "RUN_AGENT",
    "BLOCK",
    "UNBLOCK",
    "CALLBACK_SUCCESS",
    "CALLBACK_FAILED",
    "APPROVE_PLAN",
    "REVISE",
    "APPROVE_WRITE",
    "REJECT_WRITE",
    "PR_CREATED",
    "VALIDATION_PASSED",
    "VALIDATION_FAILED",
    "CANCEL"
  ]),
  actor: z.enum(["user", "agent", "system"]).default("user"),
  actor_id: z.string().optional(),
  note: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  idempotency_key: z.string().min(1).max(200).optional()
});

const uniqueIdsSchema = z.array(z.string().min(1)).min(1).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: "IDs must be unique" }
);

export const bulkCreateTasksSchema = z.object({
  tasks: z.array(createTaskSchema).min(1).max(100)
});

export const bulkUpdateTasksSchema = z.object({
  task_ids: uniqueIdsSchema,
  patch: updateTaskSchema.refine((value) => Object.keys(value).length > 0, {
    message: "patch must include at least one field"
  })
});

export const bulkDeleteTasksSchema = z.object({
  task_ids: uniqueIdsSchema,
  force: z.boolean().default(false)
});

export const bulkTransitionTasksSchema = z.object({
  task_ids: uniqueIdsSchema,
  transition: transitionTaskSchema.omit({ idempotency_key: true })
});

export const bulkCreateTaskLinksSchema = z.object({
  links: z.array(z.object({
    from_task_id: z.string().min(1),
    to_task_id: z.string().min(1),
    link_type: createTaskLinkSchema.shape.link_type,
    created_by: z.string().optional()
  }).refine((link) => link.from_task_id !== link.to_task_id, {
    message: "A task cannot link to itself"
  })).min(1).max(100)
});

export const bulkDeleteTaskLinksSchema = z.object({
  link_ids: uniqueIdsSchema
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateTaskLinkInput = z.infer<typeof createTaskLinkSchema>;
export type TransitionTaskInput = z.infer<typeof transitionTaskSchema>;
