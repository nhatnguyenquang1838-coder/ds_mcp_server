const TOKEN_KEY = "dw_agentops_api_token";

const selectedTaskIds = new Set();
const selectedLinkIds = new Set();
const selectedWorkflowTaskIds = new Set();
let workflows = [];
let selectedWorkflowId = null;

const elements = {
  bulkCreateTaskForm: document.querySelector("#bulkCreateTaskForm"),
  selectAllTasks: document.querySelector("#selectAllTasks"),
  selectedTaskCount: document.querySelector("#selectedTaskCount"),
  bulkPriority: document.querySelector("#bulkPriority"),
  bulkUpdateButton: document.querySelector("#bulkUpdateButton"),
  bulkTransition: document.querySelector("#bulkTransition"),
  bulkTransitionButton: document.querySelector("#bulkTransitionButton"),
  bulkLinkTarget: document.querySelector("#bulkLinkTarget"),
  bulkLinkType: document.querySelector("#bulkLinkType"),
  bulkLinkButton: document.querySelector("#bulkLinkButton"),
  bulkDeleteButton: document.querySelector("#bulkDeleteButton"),
  tasksList: document.querySelector("#tasksList"),
  taskDetail: document.querySelector("#taskDetail"),
  createWorkflowForm: document.querySelector("#createWorkflowForm"),
  refreshWorkflowsButton: document.querySelector("#refreshWorkflowsButton"),
  workflowsList: document.querySelector("#workflowsList"),
  workflowDetail: document.querySelector("#workflowDetail"),
  toast: document.querySelector("#toast")
};

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem(TOKEN_KEY) || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message = typeof body === "object" && body?.error ? body.error : response.statusText;
    throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${message}`);
  }
  return body;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  elements.toast.style.background = isError ? "#991b1b" : "#0f172a";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 5000);
}

function parseJson(value, fallback) {
  const trimmed = String(value || "").trim();
  return trimmed ? JSON.parse(trimmed) : fallback;
}

function selectedIds() {
  return [...selectedTaskIds];
}

function requireSelectedTasks() {
  const taskIds = selectedIds();
  if (taskIds.length === 0) throw new Error("Select at least one task");
  return taskIds;
}

function reportBatch(label, result) {
  const failed = Number(result.failed || 0);
  const succeeded = Number(result.succeeded || 0);
  if (failed === 0) {
    showToast(`${label}: ${succeeded} succeeded`);
    return;
  }
  const examples = (result.results || [])
    .filter((item) => !item.ok)
    .slice(0, 2)
    .map((item) => item.error)
    .join("; ");
  showToast(`${label}: ${succeeded} succeeded, ${failed} failed${examples ? ` · ${examples}` : ""}`, true);
}

function refreshTasks() {
  document.querySelector("#refreshButton")?.click();
}

function visibleTaskCards() {
  return [...elements.tasksList.querySelectorAll(".task-card[data-task-id]")];
}

function renderTaskSelection() {
  elements.selectedTaskCount.textContent = `${selectedTaskIds.size} selected`;
  const visibleIds = visibleTaskCards().map((card) => card.dataset.taskId).filter(Boolean);
  const selectedVisible = visibleIds.filter((taskId) => selectedTaskIds.has(taskId)).length;
  elements.selectAllTasks.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  elements.selectAllTasks.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;

  for (const card of visibleTaskCards()) {
    const checkbox = card.querySelector(".task-select");
    if (checkbox) checkbox.checked = selectedTaskIds.has(card.dataset.taskId);
    card.classList.toggle("bulk-selected", selectedTaskIds.has(card.dataset.taskId));
  }
}

function enhanceTaskCards() {
  for (const card of visibleTaskCards()) {
    if (card.querySelector(".task-select")) continue;
    const taskId = card.dataset.taskId;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-select";
    checkbox.setAttribute("aria-label", `Select task ${taskId}`);
    checkbox.checked = selectedTaskIds.has(taskId);
    card.prepend(checkbox);
  }
  renderTaskSelection();
}

elements.tasksList.addEventListener("click", (event) => {
  const checkbox = event.target.closest(".task-select");
  if (!checkbox) return;
  event.preventDefault();
  event.stopPropagation();
  const card = checkbox.closest("[data-task-id]");
  const taskId = card?.dataset.taskId;
  if (!taskId) return;
  if (selectedTaskIds.has(taskId)) selectedTaskIds.delete(taskId);
  else selectedTaskIds.add(taskId);
  renderTaskSelection();
}, true);

new MutationObserver(enhanceTaskCards).observe(elements.tasksList, {
  childList: true,
  subtree: true
});

elements.selectAllTasks.addEventListener("change", () => {
  for (const card of visibleTaskCards()) {
    const taskId = card.dataset.taskId;
    if (!taskId) continue;
    if (elements.selectAllTasks.checked) selectedTaskIds.add(taskId);
    else selectedTaskIds.delete(taskId);
  }
  renderTaskSelection();
});

elements.bulkCreateTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(event.currentTarget);
    const tasks = parseJson(formData.get("tasks_json"), []);
    if (!Array.isArray(tasks)) throw new Error("Task JSON must be an array");
    const result = await request("/api/tasks/bulk", {
      method: "POST",
      body: JSON.stringify({ tasks })
    });
    reportBatch("Bulk create", result);
    event.currentTarget.reset();
    refreshTasks();
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.bulkUpdateButton.addEventListener("click", async () => {
  try {
    const taskIds = requireSelectedTasks();
    const priority = elements.bulkPriority.value;
    if (!priority) throw new Error("Choose a priority to update");
    const result = await request("/api/tasks/bulk", {
      method: "PATCH",
      body: JSON.stringify({ task_ids: taskIds, patch: { priority } })
    });
    reportBatch("Bulk update", result);
    refreshTasks();
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.bulkTransitionButton.addEventListener("click", async () => {
  try {
    const taskIds = requireSelectedTasks();
    const result = await request("/api/tasks/bulk/transitions", {
      method: "POST",
      body: JSON.stringify({
        task_ids: taskIds,
        transition: { transition: elements.bulkTransition.value, actor: "user" }
      })
    });
    reportBatch("Bulk transition", result);
    refreshTasks();
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.bulkLinkButton.addEventListener("click", async () => {
  try {
    const taskIds = requireSelectedTasks();
    const targetTaskId = elements.bulkLinkTarget.value.trim();
    if (!targetTaskId) throw new Error("Enter a target task ID");
    const links = taskIds.map((taskId) => ({
      from_task_id: taskId,
      to_task_id: targetTaskId,
      link_type: elements.bulkLinkType.value
    }));
    const result = await request("/api/task-links/bulk", {
      method: "POST",
      body: JSON.stringify({ links })
    });
    reportBatch("Bulk link", result);
    refreshTasks();
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.bulkDeleteButton.addEventListener("click", async () => {
  try {
    const taskIds = requireSelectedTasks();
    const confirmed = window.confirm(
      `Delete ${taskIds.length} selected task(s)? Linked relationships will also be deleted. Only draft, completed, or cancelled tasks are eligible.`
    );
    if (!confirmed) return;
    const result = await request("/api/tasks/bulk", {
      method: "DELETE",
      body: JSON.stringify({ task_ids: taskIds, force: true })
    });
    for (const item of result.results || []) {
      if (item.ok && item.id) selectedTaskIds.delete(item.id);
    }
    reportBatch("Bulk delete", result);
    refreshTasks();
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.taskDetail.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-link-id]");
  if (!checkbox) return;
  if (checkbox.checked) selectedLinkIds.add(checkbox.dataset.linkId);
  else selectedLinkIds.delete(checkbox.dataset.linkId);
});

elements.taskDetail.addEventListener("click", async (event) => {
  if (!event.target.closest("#bulkDeleteLinksButton")) return;
  try {
    const linkIds = [...selectedLinkIds];
    if (linkIds.length === 0) throw new Error("Select at least one task link");
    const result = await request("/api/task-links/bulk", {
      method: "DELETE",
      body: JSON.stringify({ link_ids: linkIds })
    });
    for (const item of result.results || []) {
      if (item.ok && item.id) selectedLinkIds.delete(item.id);
    }
    reportBatch("Bulk link removal", result);
    refreshTasks();
  } catch (error) {
    showToast(error.message, true);
  }
});

new MutationObserver(() => selectedLinkIds.clear()).observe(elements.taskDetail, {
  childList: true,
  subtree: true
});

function workflowCard(workflow) {
  return `
    <button type="button" class="workflow-card ${workflow.id === selectedWorkflowId ? "active" : ""}" data-workflow-id="${escapeHtml(workflow.id)}">
      <strong>${escapeHtml(workflow.name)}</strong>
      <span>${escapeHtml(workflow.status)} · ${escapeHtml(workflow.id)}</span>
    </button>
  `;
}

function renderWorkflows() {
  elements.workflowsList.innerHTML = workflows.length
    ? workflows.map(workflowCard).join("")
    : '<div class="event-item">No workflows.</div>';
}

async function loadWorkflows() {
  const response = await request("/api/workflows?limit=100");
  workflows = response.workflows || [];
  renderWorkflows();
  if (selectedWorkflowId && workflows.some((item) => item.id === selectedWorkflowId)) {
    await selectWorkflow(selectedWorkflowId);
  } else if (selectedWorkflowId) {
    selectedWorkflowId = null;
    selectedWorkflowTaskIds.clear();
    elements.workflowDetail.className = "empty-state";
    elements.workflowDetail.textContent = "Select a workflow to manage it.";
  }
}

function workflowTaskRows(tasks) {
  if (!tasks.length) return '<div class="event-item">No workflow tasks.</div>';
  return tasks.map((task) => {
    const removable = ["queued", "waiting_external"].includes(task.status);
    return `
      <label class="workflow-task-row">
        <input type="checkbox" data-workflow-task-id="${escapeHtml(task.id)}" ${removable ? "" : "disabled"} ${selectedWorkflowTaskIds.has(task.id) ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(task.type)}</strong><br />
          ${escapeHtml(task.status)} · ${escapeHtml(task.id)}
        </span>
      </label>
    `;
  }).join("");
}

function renderWorkflowDetail(output) {
  const workflow = output.workflow;
  const tasks = output.tasks || [];
  elements.workflowDetail.className = "workflow-detail";
  elements.workflowDetail.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Selected workflow</p>
        <h2>${escapeHtml(workflow.name)}</h2>
      </div>
      <span class="pill info">${escapeHtml(workflow.status)}</span>
    </div>
    <form id="updateWorkflowForm" class="stack">
      <label>
        Name
        <input name="name" value="${escapeHtml(workflow.name)}" required />
      </label>
      <label>
        Input JSON
        <textarea name="input_json" rows="5">${escapeHtml(JSON.stringify(workflow.context_json || {}, null, 2))}</textarea>
      </label>
      <button type="submit" class="secondary">Update workflow</button>
    </form>
    <section class="detail-section">
      <h3>Add workflow tasks</h3>
      <form id="addWorkflowTasksForm" class="stack">
        <label>
          Task array (JSON)
          <textarea name="tasks_json" rows="7" required placeholder='[{"type":"plan_changes","payload_json":{}}]'></textarea>
        </label>
        <button type="submit" class="secondary">Add tasks</button>
      </form>
    </section>
    <section class="detail-section">
      <div class="bulk-toolbar-heading">
        <h3>Workflow tasks</h3>
        <button id="removeWorkflowTasksButton" type="button" class="danger">Remove selected</button>
      </div>
      <div class="workflow-task-list">${workflowTaskRows(tasks)}</div>
    </section>
    <section class="detail-section">
      <button id="deleteWorkflowButton" type="button" class="danger">Delete workflow</button>
    </section>
  `;
}

async function selectWorkflow(workflowId) {
  selectedWorkflowId = workflowId;
  selectedWorkflowTaskIds.clear();
  renderWorkflows();
  elements.workflowDetail.className = "empty-state";
  elements.workflowDetail.textContent = "Loading workflow...";
  const output = await request(`/api/workflows/${encodeURIComponent(workflowId)}`);
  renderWorkflowDetail(output);
}

elements.workflowsList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-workflow-id]");
  if (!card) return;
  try {
    await selectWorkflow(card.dataset.workflowId);
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.createWorkflowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(event.currentTarget);
    const response = await request("/api/workflows", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        source: formData.get("source"),
        first_task_type: formData.get("first_task_type"),
        input: parseJson(formData.get("input_json"), {})
      })
    });
    event.currentTarget.reset();
    selectedWorkflowId = response.workflow.id;
    showToast("Workflow created");
    await loadWorkflows();
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.refreshWorkflowsButton.addEventListener("click", async () => {
  try {
    await loadWorkflows();
    showToast("Workflows refreshed");
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.workflowDetail.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-workflow-task-id]");
  if (!checkbox) return;
  if (checkbox.checked) selectedWorkflowTaskIds.add(checkbox.dataset.workflowTaskId);
  else selectedWorkflowTaskIds.delete(checkbox.dataset.workflowTaskId);
});

elements.workflowDetail.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedWorkflowId) return;
  try {
    const formData = new FormData(event.target);
    if (event.target.id === "updateWorkflowForm") {
      await request(`/api/workflows/${encodeURIComponent(selectedWorkflowId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: formData.get("name"),
          input: parseJson(formData.get("input_json"), {})
        })
      });
      showToast("Workflow updated");
      await loadWorkflows();
      return;
    }

    if (event.target.id === "addWorkflowTasksForm") {
      const tasks = parseJson(formData.get("tasks_json"), []);
      if (!Array.isArray(tasks)) throw new Error("Workflow task JSON must be an array");
      await request(`/api/workflows/${encodeURIComponent(selectedWorkflowId)}/tasks/bulk`, {
        method: "POST",
        body: JSON.stringify({ tasks })
      });
      event.target.reset();
      showToast(`${tasks.length} workflow task(s) added`);
      await loadWorkflows();
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.workflowDetail.addEventListener("click", async (event) => {
  if (!selectedWorkflowId) return;
  try {
    if (event.target.closest("#removeWorkflowTasksButton")) {
      const taskIds = [...selectedWorkflowTaskIds];
      if (taskIds.length === 0) throw new Error("Select removable workflow tasks");
      await request(`/api/workflows/${encodeURIComponent(selectedWorkflowId)}/tasks/bulk`, {
        method: "DELETE",
        body: JSON.stringify({ task_ids: taskIds })
      });
      selectedWorkflowTaskIds.clear();
      showToast(`${taskIds.length} workflow task(s) removed`);
      await loadWorkflows();
      return;
    }

    if (event.target.closest("#deleteWorkflowButton")) {
      const confirmed = window.confirm(
        "Delete this workflow and all non-active tasks? Leased or running tasks will block deletion."
      );
      if (!confirmed) return;
      await request(`/api/workflows/${encodeURIComponent(selectedWorkflowId)}?force=true`, {
        method: "DELETE"
      });
      selectedWorkflowId = null;
      selectedWorkflowTaskIds.clear();
      showToast("Workflow deleted");
      await loadWorkflows();
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

enhanceTaskCards();
loadWorkflows().catch((error) => showToast(error.message, true));
