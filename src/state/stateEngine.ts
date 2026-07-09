import { isNonRetryableClaimFailureReason } from "../agentops/claimTargeting.js";
import type { AppConfig } from "../config.js";
import type { AsyncTask, AsyncTaskType } from "../asyncWorkflowStore.js";
import {
  appendTaskEvent,
  createTaskRecord,
  getRetryPolicyForTaskType,
  moveTaskToDeadLetter,
  scheduleTaskRetry,
  updateWorkflowStatus
} from "../repositories/orchestrationRepository.js";

export type TaskResultInput = {
  status: "succeeded" | "failed";
  summary?: string;
  artifacts?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

export type StateEngineTransitionResult = {
  task: AsyncTask;
  next_task?: AsyncTask;
};

export function evaluateNextTaskType(
  task: AsyncTask,
  result: Record<string, unknown>
): AsyncTaskType | undefined {
  if (task.status === "failed") return undefined;
  if (task.type === "analyze_repo") return "plan_changes";
  if (task.type === "plan_changes") return "modify_code";
  if (task.type === "modify_code") return "create_pr";
  if (task.type === "create_pr") return "wait_github_ci";
  if (task.type === "wait_github_ci") return result.conclusion === "failure" ? "fix_ci" : "final_report";
  if (task.type === "fix_ci") return "wait_github_ci";
  return undefined;
}

export async function applyTaskResultTransition(
  config: AppConfig,
  task: AsyncTask,
  input: TaskResultInput
): Promise<StateEngineTransitionResult> {
  await appendTaskEvent(config, {
    workflow_id: task.workflow_id,
    task_id: task.id,
    event_type: "state_engine_transition_started",
    actor: "state_engine",
    data_json: {
      task_type: task.type,
      task_status: input.status
    }
  });

  if (input.status === "failed") {
    if (isNonRetryableClaimFailureReason(input.error?.reason)) {
      const deadLetterTask = await moveTaskToDeadLetter(config, task, String(input.error?.reason ?? "wrong_task_claimed"), input.error);
      await updateWorkflowStatus(config, task.workflow_id, "failed", deadLetterTask.id);
      await appendTaskEvent(config, {
        workflow_id: task.workflow_id,
        task_id: task.id,
        event_type: "workflow_failed",
        actor: "state_engine",
        data_json: {
          reason: input.error?.reason ?? "wrong_task_claimed",
          retryable: false
        }
      });
      return { task: deadLetterTask };
    }

    const policy = await getRetryPolicyForTaskType(config, task.type, task.max_retries);

    if (task.retry_count < policy.max_attempts) {
      const retryTask = await scheduleTaskRetry(config, task, policy);
      await updateWorkflowStatus(config, task.workflow_id, "running", retryTask.id);
      await appendTaskEvent(config, {
        workflow_id: task.workflow_id,
        task_id: task.id,
        event_type: "workflow_retry_pending",
        actor: "state_engine",
        data_json: {
          attempt: task.retry_count,
          max_attempts: policy.max_attempts,
          task_type: task.type
        }
      });
      return { task: retryTask };
    }

    const deadLetterTask = await moveTaskToDeadLetter(config, task, "retry_attempts_exhausted", input.error);
    await updateWorkflowStatus(config, task.workflow_id, "failed", deadLetterTask.id);
    await appendTaskEvent(config, {
      workflow_id: task.workflow_id,
      task_id: task.id,
      event_type: "workflow_failed",
      actor: "state_engine",
      data_json: {
        reason: "retry_attempts_exhausted",
        attempt: task.retry_count,
        max_attempts: policy.max_attempts
      }
    });
    return { task: deadLetterTask };
  }

  if (task.type === "final_report") {
    await updateWorkflowStatus(config, task.workflow_id, "succeeded", undefined);
    await appendTaskEvent(config, {
      workflow_id: task.workflow_id,
      task_id: task.id,
      event_type: "workflow_succeeded",
      actor: "state_engine",
      data_json: {}
    });
    return { task };
  }

  const result = task.result_json ?? {};
  const next = evaluateNextTaskType(task, result);
  if (!next) {
    await appendTaskEvent(config, {
      workflow_id: task.workflow_id,
      task_id: task.id,
      event_type: "state_engine_no_next_task",
      actor: "state_engine",
      data_json: { task_type: task.type }
    });
    return { task };
  }

  const nextTask = await createTaskRecord(config, {
    workflow_id: task.workflow_id,
    parent_task_id: task.id,
    type: next,
    status: next === "wait_github_ci" ? "waiting_external" : "queued",
    payload_json: result,
    wait_key: String(result.head_sha ?? result.pr_number ?? "") || undefined
  });

  await updateWorkflowStatus(config, task.workflow_id, next === "wait_github_ci" ? "waiting" : "running", nextTask.id);
  await appendTaskEvent(config, {
    workflow_id: task.workflow_id,
    task_id: nextTask.id,
    event_type: "state_engine_next_task_created",
    actor: "state_engine",
    data_json: {
      previous_task_id: task.id,
      previous_task_type: task.type,
      next_task_type: next
    }
  });

  return { task, next_task: nextTask };
}
