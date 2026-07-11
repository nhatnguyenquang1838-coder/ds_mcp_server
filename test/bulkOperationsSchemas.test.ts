import assert from "node:assert/strict";
import test from "node:test";

import {
  bulkCreateTaskLinksSchema,
  bulkCreateTasksSchema,
  bulkUpdateTasksSchema
} from "../src/agentops/schemas.js";
import {
  bulkAddAsyncWorkflowTasksSchema,
  bulkRemoveAsyncWorkflowTasksSchema,
  updateAsyncWorkflowSchema
} from "../src/asyncWorkflowSchemas.js";

test("bulk task create accepts a bounded task array", () => {
  const parsed = bulkCreateTasksSchema.parse({
    tasks: [
      { title: "First task" },
      { title: "Second task", priority: "high", task_type: "implementation" }
    ]
  });

  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.tasks[0]?.priority, "medium");
});

test("bulk task update rejects duplicate IDs and empty patches", () => {
  assert.throws(() => bulkUpdateTasksSchema.parse({
    task_ids: ["task_1", "task_1"],
    patch: { priority: "high" }
  }));

  assert.throws(() => bulkUpdateTasksSchema.parse({
    task_ids: ["task_1"],
    patch: {}
  }));
});

test("bulk task links reject self-links", () => {
  assert.throws(() => bulkCreateTaskLinksSchema.parse({
    links: [{
      from_task_id: "task_1",
      to_task_id: "task_1",
      link_type: "depends_on"
    }]
  }));
});

test("workflow update requires at least one mutable field", () => {
  assert.throws(() => updateAsyncWorkflowSchema.parse({}));
  assert.deepEqual(updateAsyncWorkflowSchema.parse({ name: "Updated" }), { name: "Updated" });
});

test("workflow bulk task schemas apply defaults and unique IDs", () => {
  const addParsed = bulkAddAsyncWorkflowTasksSchema.parse({
    tasks: [{ type: "plan_changes" }]
  });
  assert.equal(addParsed.tasks[0]?.status, "queued");
  assert.deepEqual(addParsed.tasks[0]?.payload_json, {});

  assert.throws(() => bulkRemoveAsyncWorkflowTasksSchema.parse({
    task_ids: ["atask_1", "atask_1"]
  }));
});
