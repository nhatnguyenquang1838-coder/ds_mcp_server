const TOKEN_KEY = "dw_agentops_api_token";

const state = {
  tasks: [],
  selectedTaskId: null,
  token: localStorage.getItem(TOKEN_KEY) || "",
  security: null
};

const elements = {
  apiToken: document.querySelector("#apiToken"),
  saveTokenButton: document.querySelector("#saveTokenButton"),
  refreshButton: document.querySelector("#refreshButton"),
  apiStatus: document.querySelector("#apiStatus"),
  securityStatus: document.querySelector("#securityStatus"),
  securityControls: document.querySelector("#securityControls"),
  securitySignals: document.querySelector("#securitySignals"),
  metrics: document.querySelector("#metrics"),
  createTaskForm: document.querySelector("#createTaskForm"),
  searchInput: document.querySelector("#searchInput"),
  stateFilter: document.querySelector("#stateFilter"),
  tasksList: document.querySelector("#tasksList"),
  taskDetail: document.querySelector("#taskDetail"),
  toast: document.querySelector("#toast")
};

elements.apiToken.value = state.token;

function headers() {
  const output = { "Content-Type": "application/json" };
  if (state.token) output.Authorization = `Bearer ${state.token}`;
  return output;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const requestId = response.headers.get("x-request-id");
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const responseError = typeof body === "object" && body ? body.error : undefined;
    const responseDetail = typeof body === "object" && body ? body.detail : undefined;
    const bodyRequestId = typeof body === "object" && body ? body.request_id : undefined;
    const parts = [
      `${options.method || "GET"} ${path} failed with ${response.status}`,
      responseError || response.statusText,
      responseDetail ? `detail: ${responseDetail}` : undefined,
      bodyRequestId || requestId ? `request_id: ${bodyRequestId || requestId}` : undefined
    ].filter(Boolean);
    throw new Error(parts.join(" · "));
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

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function pillClass(stateValue) {
  if (["completed"].includes(stateValue)) return "ok";
  if (["blocked", "pending_review", "pending_approval", "validation_running"].includes(stateValue)) return "warn";
  if (["failed", "cancelled"].includes(stateValue)) return "danger";
  if (["ready", "agent_running", "write_running"].includes(stateValue)) return "info";
  return "muted";
}

function statusClass(configured) {
  return configured ? "ok" : "warn";
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  elements.toast.style.background = isError ? "#991b1b" : "#0f172a";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function taskMatchesFilters(task) {
  const search = elements.searchInput.value.trim().toLowerCase();
  const stateFilter = elements.stateFilter.value;

  const matchesSearch = !search ||
    task.title.toLowerCase().includes(search) ||
    task.id.toLowerCase().includes(search);
  const matchesState = !stateFilter || task.state === stateFilter;

  return matchesSearch && matchesState;
}

function renderMetrics() {
  const counts = state.tasks.reduce((acc, task) => {
    acc.total += 1;
    acc[task.state] = (acc[task.state] || 0) + 1;
    return acc;
  }, { total: 0 });

  const cards = [
    ["Total", counts.total || 0],
    ["Ready", counts.ready || 0],
    ["Running", (counts.agent_running || 0) + (counts.write_running || 0) + (counts.validation_running || 0)],
    ["Blocked", counts.blocked || 0],
    ["Pending", (counts.pending_review || 0) + (counts.pending_approval || 0)],
    ["Completed", counts.completed || 0]
  ];

  elements.metrics.innerHTML = cards.map(([label, value]) => `
    <div class="metric">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderSecurity() {
  const posture = state.security;
  if (!posture) {
    elements.securityStatus.textContent = "loading";
    elements.securityControls.innerHTML = "";
    elements.securitySignals.innerHTML = "";
    return;
  }

  const controls = posture.controls || [];
  const signals = posture.signals || { total: 0, by_kind: {}, recent: [] };

  elements.securityStatus.textContent = posture.summary?.enforcement || "unknown";
  elements.securityStatus.className = `pill ${posture.summary?.enforcement === "strict" ? "ok" : "warn"}`;

  elements.securityControls.innerHTML = controls.map((control) => `
    <div class="security-control">
      <div>
        <strong>${escapeHtml(control.name)}</strong><br />
        <span>${escapeHtml(control.detail || "")}</span>
      </div>
      <span class="pill ${statusClass(control.configured)}">${control.configured ? "on" : "off"}</span>
    </div>
  `).join("");

  const byKind = signals.by_kind || {};
  const recent = signals.recent || [];
  elements.securitySignals.innerHTML = `
    <div class="security-signal">
      <strong>Signals</strong><br />
      <span>Total: ${escapeHtml(signals.total ?? 0)}</span>
    </div>
    <div class="security-signal">
      <strong>Auth denials</strong><br />
      <span>${escapeHtml(byKind.auth_denied ?? 0)}</span>
    </div>
    <div class="security-signal">
      <strong>Rate limits</strong><br />
      <span>${escapeHtml(byKind.rate_limited ?? 0)}</span>
    </div>
    <div class="security-signal">
      <strong>Recent</strong><br />
      <span>${recent.length ? escapeHtml(recent[0].kind + " · " + recent[0].timestamp) : "none"}</span>
    </div>
  `;
}

function renderTasks() {
  const tasks = state.tasks.filter(taskMatchesFilters);

  if (tasks.length === 0) {
    elements.tasksList.innerHTML = `<div class="empty-state">No matching tasks.</div>`;
    return;
  }

  elements.tasksList.innerHTML = tasks.map((task) => `
    <article class="task-card ${task.id === state.selectedTaskId ? "active" : ""}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-title">
        <strong>${escapeHtml(task.title)}</strong>
        <span class="pill ${pillClass(task.state)}">${escapeHtml(task.state)}</span>
      </div>
      <div class="meta-row">
        <span>${escapeHtml(task.id)}</span>
        <span>${escapeHtml(task.task_type)}</span>
        <span>${escapeHtml(task.priority)}</span>
        <span>updated ${formatDate(task.updated_at)}</span>
      </div>
    </article>
  `).join("");
}

function renderDetailLoading() {
  elements.taskDetail.className = "empty-state";
  elements.taskDetail.textContent = "Loading task detail...";
}

async function selectTask(taskId) {
  state.selectedTaskId = taskId;
  renderTasks();
  renderDetailLoading();

  const [taskResponse, linksResponse, eventsResponse] = await Promise.all([
    request(`/api/tasks/${encodeURIComponent(taskId)}`),
    request(`/api/tasks/${encodeURIComponent(taskId)}/links`),
    request(`/api/tasks/${encodeURIComponent(taskId)}/events`)
  ]);

  renderTaskDetail(
    taskResponse.task,
    taskResponse.available_transitions || [],
    linksResponse.links || [],
    eventsResponse.events || []
  );
}

function renderTaskDetail(task, transitions, links, events) {
  elements.taskDetail.className = "";

  elements.taskDetail.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Selected task</p>
        <h2>${escapeHtml(task.title)}</h2>
      </div>
      <span class="pill ${pillClass(task.state)}">${escapeHtml(task.state)}</span>
    </div>

    <div class="detail-grid">
      ${kv("ID", task.id)}
      ${kv("Type", task.task_type)}
      ${kv("Priority", task.priority)}
      ${kv("Source", task.source)}
      ${kv("Created", formatDate(task.created_at))}
      ${kv("Updated", formatDate(task.updated_at))}
      ${task.description ? kv("Description", task.description) : ""}
    </div>

    <section class="detail-section">
      <h3>Transitions</h3>
      <div class="transition-grid">
        ${transitions.length === 0 ? "<span class=\"pill muted\">No transitions</span>" : transitions.map((transition) => `
          <button data-transition="${escapeHtml(transition)}" ${transition === "CANCEL" ? "class=\"danger\"" : ""}>${escapeHtml(transition)}</button>
        `).join("")}
      </div>
    </section>

    <section class="detail-section">
      <h3>Add dependency link</h3>
      <form id="linkForm" class="stack">
        <label>
          Target task ID
          <input name="to_task_id" placeholder="task_xxx" required />
        </label>
        <label>
          Link type
          <select name="link_type">
            <option value="depends_on">depends_on</option>
            <option value="blocks">blocks</option>
            <option value="relates_to">relates_to</option>
            <option value="parent_child">parent_child</option>
            <option value="implements">implements</option>
            <option value="validates">validates</option>
            <option value="derived_from">derived_from</option>
            <option value="duplicates">duplicates</option>
          </select>
        </label>
        <button type="submit" class="secondary">Add link</button>
      </form>
    </section>

    <section class="detail-section">
      <div class="bulk-toolbar-heading">
        <h3>Links</h3>
        <button id="bulkDeleteLinksButton" type="button" class="danger">Remove selected</button>
      </div>
      <div class="link-list">
        ${links.length === 0 ? "<div class=\"event-item\">No links.</div>" : links.map((link) => `
          <label class="link-item selectable-link">
            <input type="checkbox" data-link-id="${escapeHtml(link.id)}" />
            <span>
              <strong>${escapeHtml(link.link_type)}</strong><br />
              ${escapeHtml(link.from_task_id)} -> ${escapeHtml(link.to_task_id)}
            </span>
          </label>
        `).join("")}
      </div>
    </section>

    <section class="detail-section">
      <h3>Timeline</h3>
      <div class="event-list">
        ${events.length === 0 ? "<div class=\"event-item\">No events.</div>" : events.map((event) => `
          <div class="event-item">
            <strong>${escapeHtml(event.event_type)}</strong>
            <div>${escapeHtml(event.from_state || "-")} -> ${escapeHtml(event.to_state || "-")}</div>
            <div>${formatDate(event.created_at)} · ${escapeHtml(event.actor)}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function kv(label, value) {
  return `
    <div class="kv">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

async function loadCapabilities() {
  const capabilities = await request("/api/capabilities");
  elements.apiStatus.textContent = capabilities.auth?.supabase_configured ? "supabase connected" : "supabase missing";
  elements.apiStatus.className = `pill ${capabilities.auth?.supabase_configured ? "ok" : "warn"}`;
}

async function loadSecurity() {
  state.security = await request("/api/security/posture");
  renderSecurity();
}

async function loadTasks() {
  const response = await request("/api/tasks");
  state.tasks = response.tasks || [];
  renderMetrics();
  renderTasks();
}

async function refreshAll() {
  try {
    await Promise.all([loadCapabilities(), loadSecurity(), loadTasks()]);
    if (state.selectedTaskId) await selectTask(state.selectedTaskId);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function createTask(form) {
  const formData = new FormData(form);
  const payload = {
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    task_type: formData.get("task_type"),
    priority: formData.get("priority"),
    source: "manual"
  };

  const response = await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  form.reset();
  showToast("Task created");
  await loadTasks();
  await selectTask(response.task.id);
}

async function transitionSelectedTask(transition) {
  if (!state.selectedTaskId) return;
  await request(`/api/tasks/${encodeURIComponent(state.selectedTaskId)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition, actor: "user" })
  });
  showToast(`Transition applied: ${transition}`);
  await loadTasks();
  await selectTask(state.selectedTaskId);
}

async function addLink(form) {
  if (!state.selectedTaskId) return;
  const formData = new FormData(form);
  await request(`/api/tasks/${encodeURIComponent(state.selectedTaskId)}/links`, {
    method: "POST",
    body: JSON.stringify({
      to_task_id: formData.get("to_task_id"),
      link_type: formData.get("link_type")
    })
  });
  form.reset();
  showToast("Link added");
  await selectTask(state.selectedTaskId);
}

elements.saveTokenButton.addEventListener("click", () => {
  state.token = elements.apiToken.value.trim();
  if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
  else localStorage.removeItem(TOKEN_KEY);
  showToast("Token saved locally");
  refreshAll();
});

elements.refreshButton.addEventListener("click", refreshAll);
elements.searchInput.addEventListener("input", renderTasks);
elements.stateFilter.addEventListener("change", renderTasks);

elements.createTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await createTask(event.currentTarget);
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.tasksList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-task-id]");
  if (!card) return;
  try {
    await selectTask(card.dataset.taskId);
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.taskDetail.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-transition]");
  if (!button) return;
  try {
    await transitionSelectedTask(button.dataset.transition);
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.taskDetail.addEventListener("submit", async (event) => {
  if (event.target.id !== "linkForm") return;
  event.preventDefault();
  try {
    await addLink(event.target);
  } catch (error) {
    showToast(error.message, true);
  }
});

refreshAll();
