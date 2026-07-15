const state = {
  tasks: [],
  tasksError: null,
  links: [],
  linksError: null,
  selectedTaskId: null,
  token: "",
  user: null,
  authState: "logged_out",
  security: null,
  securityError: null,
  environment: null,
  environmentError: null,
  taskViewMode: "list",
  mobileView: "progress"
};

const elements = {
  loginScreen: document.querySelector("#loginScreen"),
  appShell: document.querySelector("#appShell"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  loginStatus: document.querySelector("#loginStatus"),
  buildVersion: document.querySelector("#buildVersion"),
  loginBuildVersion: document.querySelector("#loginBuildVersion"),
  sessionUserValue: document.querySelector("#sessionUserValue"),
  sessionTokenValue: document.querySelector("#sessionTokenValue"),
  configButton: document.querySelector("#configButton"),
  refreshButton: document.querySelector("#refreshButton"),
  apiStatus: document.querySelector("#apiStatus"),
  environmentStatus: document.querySelector("#environmentStatus"),
  environmentForm: document.querySelector("#environmentForm"),
  runtimeModeSelect: document.querySelector("#runtimeModeSelect"),
  dbTargetSelect: document.querySelector("#dbTargetSelect"),
  runtimeModeValue: document.querySelector("#runtimeModeValue"),
  dbTargetValue: document.querySelector("#dbTargetValue"),
  dbHostValue: document.querySelector("#dbHostValue"),
  devToolsValue: document.querySelector("#devToolsValue"),
  productionPresetButton: document.querySelector("#productionPresetButton"),
  securityStatus: document.querySelector("#securityStatus"),
  securityControls: document.querySelector("#securityControls"),
  securitySignals: document.querySelector("#securitySignals"),
  metrics: document.querySelector("#metrics"),
  createTaskForm: document.querySelector("#createTaskForm"),
  searchInput: document.querySelector("#searchInput"),
  stateFilter: document.querySelector("#stateFilter"),
  taskListViewButton: document.querySelector("#taskListViewButton"),
  taskGraphViewButton: document.querySelector("#taskGraphViewButton"),
  tasksList: document.querySelector("#tasksList"),
  taskGraph: document.querySelector("#taskGraph"),
  taskDetail: document.querySelector("#taskDetail"),
  envModal: document.querySelector("#envModal"),
  envModalBackdrop: document.querySelector("#envModalBackdrop"),
  envModalCloseButton: document.querySelector("#envModalCloseButton"),
  envModalDismissButton: document.querySelector("#envModalDismissButton"),
  envModalTitle: document.querySelector("#envModalTitle"),
  envIssuesButton: document.querySelector("#envIssuesButton"),
  envModalRefreshButton: document.querySelector("#envModalRefreshButton"),
  envCopyFixButton: document.querySelector("#envCopyFixButton"),
  envModalSummary: document.querySelector("#envModalSummary"),
  envModalIssues: document.querySelector("#envModalIssues"),
  envModalFixSnippet: document.querySelector("#envModalFixSnippet"),
  mobileNav: document.querySelector(".mobile-nav"),
  mobileNavButtons: document.querySelectorAll(".mobile-nav-button"),
  toast: document.querySelector("#toast")
};

const RUNTIME_MODES = ["local", "development", "staging", "production"];
const MOBILE_VIEWS = ["progress", "tasks", "assign", "flow"];

function hasToken() {
  return Boolean(state.token);
}

function syncAuthUi() {
  const authenticated = hasToken();
  elements.loginScreen.hidden = authenticated;
  elements.appShell.hidden = !authenticated;
  elements.loginStatus.textContent = authenticated
    ? "Ready"
    : "Sign in with email/password or use Supabase SSO";
  if (authenticated) {
    elements.sessionTokenValue.textContent = "HttpOnly cookie";
    elements.sessionUserValue.textContent = state.user?.email || state.user?.id || "signed in";
  } else {
    elements.sessionTokenValue.textContent = "-";
    elements.sessionUserValue.textContent = "-";
  }
  window.dispatchEvent(new CustomEvent("admin-auth-changed", {
    detail: { authenticated }
  }));
}

syncAuthUi();

function isMobileViewport() {
  return window.matchMedia("(max-width: 860px)").matches;
}

function renderMobileViewport() {
  const mobile = isMobileViewport();
  const activeView = MOBILE_VIEWS.includes(state.mobileView) ? state.mobileView : "progress";

  document.body.classList.toggle("mobile-shell", mobile);
  elements.mobileNav.hidden = !mobile;

  document.querySelectorAll("[data-mobile-panel]").forEach((panel) => {
    const panelView = panel.dataset.mobilePanel || "";
    panel.classList.toggle("mobile-hidden", mobile && panelView !== activeView);
  });

  elements.mobileNavButtons.forEach((button) => {
    const active = mobile && button.dataset.mobileView === activeView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setMobileView(view) {
  state.mobileView = MOBILE_VIEWS.includes(view) ? view : "progress";
  renderMobileViewport();
}

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
    throw new Error(parts.join(" | "));
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

function runtimeModeLabel(value) {
  return value || "unknown";
}

function databaseTargetLabel(profile) {
  const parts = [profile.target];

  if (profile.real_database_guard_required) {
    parts.push("(guarded)");
  }

  if (!profile.configured) {
    parts.push("(not configured)");
  } else if (profile.supabase_host) {
    parts.push(`- ${profile.supabase_host}`);
  }

    return parts.join(" | ");
}

function envVarToken() {
  return "<generate-random-token>";
}

function envIssueFixLine(controlName) {
  const lines = {
    "REST bearer": `DS_MCP_REST_API_BEARER_TOKEN=${envVarToken()}`,
    "MCP bearer": `DS_MCP_MCP_BEARER_TOKEN=${envVarToken()}`,
    "MCP URL secret": `DS_MCP_MCP_URL_SECRET=${envVarToken()}`,
    "GitHub webhook": `DS_MCP_GITHUB_WEBHOOK_SECRET=${envVarToken()}`,
    "Internal callback": `DS_MCP_WORKSPACE_AGENT_CALLBACK_TOKEN=${envVarToken()}`,
    "Supabase": [
      "DS_MCP_SUPABASE_URL=https://<your-project>.supabase.co",
      "DS_MCP_SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>"
    ].join("\n"),
    "CORS allowlist": "DS_MCP_CORS_ALLOWED_ORIGINS=http://localhost:8787"
  };

  return lines[controlName] || `# Add the required ${controlName} env var`;
}

function summarizeCount(count) {
  return count === 1 ? "1 issue" : `${count} issues`;
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
    task.id.toLowerCase().includes(search) ||
    (task.assigned_agent_id || "").toLowerCase().includes(search) ||
    (task.latest_run_id || "").toLowerCase().includes(search) ||
    (task.repo_owner || "").toLowerCase().includes(search) ||
    (task.repo_name || "").toLowerCase().includes(search) ||
    (task.repo_branch || "").toLowerCase().includes(search);
  const matchesState = taskMatchesFilterValue(task, stateFilter);

  return matchesSearch && matchesState;
}

function taskRelationshipCounts(taskId) {
  const incoming = state.links.filter((link) => link.to_task_id === taskId).length;
  const outgoing = state.links.filter((link) => link.from_task_id === taskId).length;
  return { incoming, outgoing, total: incoming + outgoing };
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

function renderViewToggle() {
  elements.taskListViewButton.classList.toggle("active", state.taskViewMode === "list");
  elements.taskListViewButton.setAttribute("aria-pressed", String(state.taskViewMode === "list"));
  elements.taskGraphViewButton.classList.toggle("active", state.taskViewMode === "graph");
  elements.taskGraphViewButton.setAttribute("aria-pressed", String(state.taskViewMode === "graph"));
  elements.tasksList.hidden = state.taskViewMode !== "list";
  elements.taskGraph.hidden = state.taskViewMode !== "graph";
}

function renderQuickFilters() {
  const current = taskFilterValue(elements.stateFilter.value);
  document.querySelectorAll(".quick-filter").forEach((button) => {
    const filter = button.dataset.filter || "";
    const normalized = taskFilterValue(filter);
    const active = normalized === current || (!normalized && !current);
    button.classList.toggle("active", active);
  });
}

function renderTaskCard(task) {
  const relationCounts = taskRelationshipCounts(task.id);
  const claimTime = taskClaimTime(task);
  const stateSummary = taskStatusSummary(task);
  const running = isRunningState(task.state);

  return `
    <article class="task-card ${task.id === state.selectedTaskId ? "active" : ""} ${running ? "running" : ""}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-title">
        <strong title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</strong>
        <span class="pill ${pillClass(task.state)}">${escapeHtml(stateSummary)}</span>
      </div>
      <div class="task-card-subtitle">
        <span>${escapeHtml(task.id)}</span>
        <span>${escapeHtml(task.task_type)}</span>
        <span>${escapeHtml(task.priority)}</span>
      </div>
      <div class="task-card-meta">
        <span>Agent: ${escapeHtml(taskAgentLabel(task))}</span>
        <span>Claimed: ${escapeHtml(formatRelativeTime(claimTime))}</span>
        <span>Links: ${relationCounts.total}</span>
        <span>${escapeHtml(taskWorkflowLabel(task))}</span>
      </div>
    </article>
  `;
}

function taskParentId(task) {
  return task.parent_task_id || "";
}

function buildTaskTree(tasks) {
  const nodes = new Map(tasks.map((task) => [task.id, { task, children: [] }]));
  const roots = [];

  for (const task of tasks) {
    const node = nodes.get(task.id);
    const parentId = taskParentId(task);
    const parent = parentId ? nodes.get(parentId) : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const compare = (left, right) => {
    const leftTime = new Date(left.task.updated_at || left.task.created_at || 0).getTime();
    const rightTime = new Date(right.task.updated_at || right.task.created_at || 0).getTime();
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(left.task.title).localeCompare(String(right.task.title));
  };

  const walk = (node) => {
    node.children.sort(compare);
    node.children.forEach(walk);
  };

  roots.sort(compare).forEach(walk);
  return roots;
}

function renderTaskTreeNode(node) {
  const childrenMarkup = node.children.length > 0
    ? `<div class="task-tree-children">${node.children.map((child) => renderTaskTreeNode(child)).join("")}</div>`
    : "";

  return `
    <div class="task-tree-branch">
      ${renderTaskCard(node.task)}
      ${childrenMarkup}
    </div>
  `;
}

function renderTaskList(tasks) {
  if (tasks.length === 0) {
    elements.tasksList.innerHTML = state.tasksError
      ? `<div class="empty-state"><strong>Task list failed to load</strong><br />${escapeHtml(state.tasksError)}</div>`
      : `<div class="empty-state">No matching tasks.</div>`;
    return;
  }

  const tree = buildTaskTree(tasks);
  elements.tasksList.innerHTML = `<div class="task-tree">${tree.map((node) => renderTaskTreeNode(node)).join("")}</div>`;
}

function splitWrappedText(value, maxChars = 26, maxLines = 2) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["-"];

  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    } else {
      lines.push(word.length > maxChars ? `${word.slice(0, Math.max(1, maxChars - 1))}...` : word);
    }

    current = word;
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  const joined = words.join(" ");
  const rendered = lines.join(" ");
  if (joined.length > rendered.length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\s+$/, "")}...`;
  }

  return lines;
}

function renderSvgTextLines(lines, x, lineHeight = 14) {
  return lines.map((line, index) => `
    <tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>
  `).join("");
}

function renderGraphLinkage(tasks, links) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visibleLinks = links.filter((link) => byId.has(link.from_task_id) && byId.has(link.to_task_id));

  if (state.linksError) {
    return `
      <div class="graph-linkage error">
        <strong>Linkage unavailable</strong>
        <span>${escapeHtml(state.linksError)}</span>
      </div>
    `;
  }

  if (visibleLinks.length === 0) {
    return `
      <div class="graph-linkage empty">
        <strong>No active links</strong>
        <span>There are no active dependency links to display.</span>
      </div>
    `;
  }

  return `
    <div class="graph-linkage">
      <div class="graph-linkage-header">
        <strong>Actual linkage</strong>
        <span class="pill muted">${visibleLinks.length} links</span>
      </div>
      <div class="graph-linkage-list">
        ${visibleLinks.map((link) => {
          const from = byId.get(link.from_task_id);
          const to = byId.get(link.to_task_id);
          return `
            <button type="button" class="graph-linkage-item" data-link-from="${escapeHtml(link.from_task_id)}" data-link-to="${escapeHtml(link.to_task_id)}">
              <span class="graph-linkage-type pill">${escapeHtml(link.link_type)}</span>
              <span class="graph-linkage-text">
                <strong>${escapeHtml(from?.title || link.from_task_id)}</strong>
                <span>-></span>
                <strong>${escapeHtml(to?.title || link.to_task_id)}</strong>
              </span>
              <span class="graph-linkage-meta">${escapeHtml(link.from_task_id)} -> ${escapeHtml(link.to_task_id)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function graphTaskNodes() {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const edges = state.links.filter((link) => byId.has(link.from_task_id) && byId.has(link.to_task_id));
  const nodes = state.tasks.map((task) => ({
    task,
    match: taskMatchesFilters(task)
  }));

  const levels = new Map(nodes.map(({ task }) => [task.id, 0]));
  for (let pass = 0; pass < Math.max(nodes.length, 1); pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const fromLevel = levels.get(edge.from_task_id) ?? 0;
      const nextLevel = fromLevel + 1;
      if (nextLevel > (levels.get(edge.to_task_id) ?? 0)) {
        levels.set(edge.to_task_id, nextLevel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map();
  for (const { task } of nodes) {
    const level = levels.get(task.id) ?? 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(task);
  }

  const orderedLevels = [...columns.keys()].sort((a, b) => a - b);
  const columnWidth = 280;
  const rowHeight = 110;
  const padding = 48;
  const maxRows = Math.max(...orderedLevels.map((level) => columns.get(level).length), 1);
  const width = Math.max(920, orderedLevels.length * columnWidth + padding * 2);
  const height = Math.max(420, maxRows * rowHeight + padding * 2);

  const positions = new Map();
  orderedLevels.forEach((level, columnIndex) => {
    const columnTasks = columns.get(level) || [];
    columnTasks.forEach((task, rowIndex) => {
      positions.set(task.id, {
        x: padding + columnIndex * columnWidth,
        y: padding + rowIndex * rowHeight
      });
    });
  });

  const edgeMarkup = edges.map((link) => {
    const from = positions.get(link.from_task_id);
    const to = positions.get(link.to_task_id);
    if (!from || !to) return "";
    const x1 = from.x + 210;
    const y1 = from.y + 46;
    const x2 = to.x;
    const y2 = to.y + 46;
    const midX = x1 + Math.max(48, (x2 - x1) / 2);
    const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return `
      <g class="graph-edge graph-edge-${escapeHtml(link.link_type)}">
        <path d="${path}" marker-end="url(#graphArrow)" />
      </g>
    `;
  }).join("");

  const nodeMarkup = nodes.map(({ task, match }) => {
    const position = positions.get(task.id);
    if (!position) return "";
    const relationCounts = taskRelationshipCounts(task.id);
    const titleLines = splitWrappedText(task.title, 26, 2);
    return `
      <g class="graph-node ${match ? "match" : "dim"} ${task.id === state.selectedTaskId ? "active" : ""}" data-task-id="${escapeHtml(task.id)}" transform="translate(${position.x}, ${position.y})">
        <rect class="graph-node-card" width="210" height="92" rx="14" ry="14"></rect>
        <text class="graph-node-title" x="14" y="22">${renderSvgTextLines(titleLines, 14, 14)}</text>
        <text class="graph-node-meta" x="14" y="56">${escapeHtml(taskStatusSummary(task))} | ${escapeHtml(task.priority)} | ${escapeHtml(taskAgentLabel(task))}</text>
        <text class="graph-node-meta" x="14" y="72">${escapeHtml(task.id)}</text>
        <text class="graph-node-badge" x="174" y="22">${relationCounts.total}</text>
        <title>${escapeHtml(task.title)} | ${escapeHtml(task.state)} | Agent: ${escapeHtml(taskAgentLabel(task))}</title>
      </g>
    `;
  }).join("");

  const highlighted = nodes.filter(({ match }) => match).length;
  const legend = `
    <div class="graph-legend">
      <span class="pill info">${highlighted}/${nodes.length} match filter</span>
      <span class="pill muted">${edges.length} links</span>
      <span class="pill muted">Click nodes to inspect</span>
    </div>
  `;

  return `
    <div class="graph-shell">
      ${legend}
      ${renderGraphLinkage(state.tasks, state.links)}
      <svg class="task-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Task dependency graph">
        <defs>
          <linearGradient id="graphBg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#f8fafc"></stop>
            <stop offset="100%" stop-color="#eef2ff"></stop>
          </linearGradient>
          <marker id="graphArrow" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto">
            <path d="M 0 0 L 12 6 L 0 12 z" fill="#94a3b8"></path>
          </marker>
        </defs>
        <rect x="0" y="0" width="${width}" height="${height}" fill="url(#graphBg)"></rect>
        ${edgeMarkup}
        ${nodeMarkup}
      </svg>
    </div>
  `;
}

function renderTaskGraph(tasks) {
  if (state.tasks.length === 0) {
    elements.taskGraph.innerHTML = state.tasksError
      ? `<div class="empty-state"><strong>Task graph failed to load</strong><br />${escapeHtml(state.tasksError)}</div>`
      : `<div class="empty-state">No tasks to graph.</div>`;
    return;
  }

  elements.taskGraph.innerHTML = graphTaskNodes();
}

function setEnvironmentControlsDisabled(disabled) {
  const controls = elements.environmentForm.querySelectorAll("input, select, button");
  controls.forEach((control) => {
    control.disabled = disabled;
  });
}

function renderEnvironment() {
  const status = state.environment;

  if (!status) {
    elements.environmentStatus.textContent = state.environmentError ? "error" : "unavailable";
    elements.environmentStatus.className = "pill warn";
    elements.runtimeModeValue.textContent = "-";
    elements.dbTargetValue.textContent = "-";
    elements.dbHostValue.textContent = "-";
    elements.devToolsValue.textContent = "-";
    elements.dbTargetSelect.innerHTML = "";
    setEnvironmentControlsDisabled(true);
    return;
  }

  const profiles = (status.database?.profiles || []).slice();
  const currentTarget = status.active_db_target || "default";
  const currentRuntime = status.runtime_mode || "local";
  const runtimeIsProduction = currentRuntime === "production" || currentTarget === "production";
  const statusText = !status.dev_tools?.enabled
    ? "disabled"
    : runtimeIsProduction
      ? "production"
      : "ready";

  elements.environmentStatus.textContent = statusText;
  elements.environmentStatus.className = `pill ${status.dev_tools?.enabled ? "ok" : "warn"}`;
  elements.runtimeModeValue.textContent = runtimeModeLabel(currentRuntime);
  elements.dbTargetValue.textContent = currentTarget;
  elements.dbHostValue.textContent = status.database?.supabase_host || "not configured";
  elements.devToolsValue.textContent = status.dev_tools?.enabled
    ? `enabled${status.dev_tools?.real_db_switch_allowed ? "" : ", real DB switch guarded"}`
    : "disabled";

  elements.runtimeModeSelect.disabled = !status.dev_tools?.enabled;
  elements.dbTargetSelect.disabled = !status.dev_tools?.enabled;
  elements.productionPresetButton.disabled = !status.dev_tools?.enabled;

  elements.dbTargetSelect.innerHTML = profiles.map((profile) => {
    const selected = profile.target === currentTarget ? "selected" : "";
    const disabled = !profile.configured && profile.target !== currentTarget ? "disabled" : "";
    const label = databaseTargetLabel(profile);
    return `<option value="${escapeHtml(profile.target)}" ${selected} ${disabled}>${escapeHtml(label)}</option>`;
  }).join("");

  elements.runtimeModeSelect.value = RUNTIME_MODES.includes(currentRuntime) ? currentRuntime : "local";
  elements.dbTargetSelect.value = currentTarget;
}

function renderSecurity() {
  const posture = state.security;
  if (!posture) {
    elements.securityStatus.textContent = state.securityError ? "error" : "loading";
    elements.securityStatus.className = `pill ${state.securityError ? "warn" : "muted"}`;
    elements.securityControls.innerHTML = "";
    elements.securitySignals.innerHTML = state.securityError
      ? `<div class="security-signal"><strong>Security load error</strong><br /><span>${escapeHtml(state.securityError)}</span></div>`
      : "";
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
      <span>${recent.length ? escapeHtml(recent[0].kind + " | " + recent[0].timestamp) : "none"}</span>
    </div>
  `;
}

function renderTasks() {
  const tasks = state.tasks.filter(taskMatchesFilters);
  renderViewToggle();
  renderQuickFilters();
  renderTaskList(tasks);
  renderTaskGraph(tasks);
  renderMobileViewport();
}

function renderDetailLoading() {
  elements.taskDetail.className = "empty-state";
  elements.taskDetail.textContent = "Loading task detail...";
}

async function selectTask(taskId) {
  state.selectedTaskId = taskId;
  renderTasks();
  if (isMobileViewport()) setMobileView("assign");
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
      ${kv("Agent", taskAgentLabel(task))}
      ${kv("Claimed", formatDate(taskClaimTime(task)))}
      ${kv("Run count", String(task.run_count ?? 0))}
      ${kv("Latest run", task.latest_run_id || "-")}
      ${kv("Root task", task.root_task_id || "-")}
      ${kv("Repo", task.repo_owner && task.repo_name ? `${task.repo_owner}/${task.repo_name}` : "-")}
      ${kv("Branch", task.repo_branch || "-")}
      ${kv("PR", task.pr_number ? `#${task.pr_number}` : "-")}
      ${kv("PR URL", task.pr_url || "-")}
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
            <div>${formatDate(event.created_at)} | ${escapeHtml(event.actor)}</div>
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

function buildEnvironmentIssues() {
  const issues = [];
  const posture = state.security;
  const env = state.environment;

  if (state.securityError) {
    issues.push({
      severity: "error",
      title: "Security posture failed to load",
      detail: state.securityError,
      fix: "Verify DS_MCP_REST_API_BEARER_TOKEN is correct, then refresh the page."
    });
  }

  if (state.environmentError) {
    issues.push({
      severity: "error",
      title: "Environment status failed to load",
      detail: state.environmentError,
      fix: "Verify the admin token and refresh the page."
    });
  }

  if (state.tasksError) {
    const missingSchema = /could not find the table 'public\.agentops_tasks'|schema cache/i.test(state.tasksError);
    issues.push({
      severity: "error",
      title: missingSchema ? "Task schema is missing" : "Task API failed",
      detail: state.tasksError,
      fix: missingSchema
        ? [
            "Apply the AgentOps task migrations to your Supabase project:",
            "supabase/migrations/20260706150000_agentops_tasks.sql",
            "supabase/migrations/20260707162000_agentops_idempotency.sql"
          ].join("\n")
        : "Check the task API response and the active Supabase credentials."
    });
  }

  if (env) {
    if (!env.dev_tools?.enabled) {
      issues.push({
        severity: "warn",
        title: "Dev tools are disabled",
        detail: "The environment switcher cannot change runtime settings while DS_MCP_DEV_TOOLS_ENABLED is false.",
        fix: "DS_MCP_DEV_TOOLS_ENABLED=true"
      });
    }

    if (!env.dev_tools?.real_db_switch_allowed) {
      issues.push({
        severity: "warn",
        title: "Real DB switching is guarded",
        detail: "Production and real database targets need explicit approval in this local setup.",
        fix: "DS_MCP_DEV_TOOLS_ALLOW_REAL_DB_SWITCH=true"
      });
    }

    const productionProfile = (env.database?.profiles || []).find((profile) => profile.target === "production");
    if (productionProfile && !productionProfile.configured) {
      issues.push({
        severity: "error",
        title: "Production database profile is missing",
        detail: "The production Supabase URL or service role key is not configured.",
        fix: [
          "DS_MCP_SUPABASE_PRODUCTION_URL=https://<your-project>.supabase.co",
          "DS_MCP_SUPABASE_PRODUCTION_SERVICE_ROLE_KEY=<your-service-role-key>"
        ].join("\n")
      });
    }

    if (!env.database?.configured) {
      issues.push({
        severity: "error",
        title: "Active Supabase connection is missing",
        detail: "The current active database target does not have a Supabase URL and service role key.",
        fix: [
          "DS_MCP_SUPABASE_URL=https://<your-project>.supabase.co",
          "DS_MCP_SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>"
        ].join("\n")
      });
    }
  }

  const missingControls = (posture?.controls || []).filter((control) => !control.configured);
  for (const control of missingControls) {
    issues.push({
      severity: control.name === "Supabase" ? "error" : "warn",
      title: `${control.name} is not configured`,
      detail: `${control.detail || control.name} is missing or empty.`,
      fix: envIssueFixLine(control.name)
    });
  }

  return issues;
}

function buildEnvironmentFixSnippet(issues) {
  const snippetLines = new Set();

  if (state.environment) {
    if (!state.environment.dev_tools?.enabled) snippetLines.add("DS_MCP_DEV_TOOLS_ENABLED=true");
    if (!state.environment.dev_tools?.real_db_switch_allowed) snippetLines.add("DS_MCP_DEV_TOOLS_ALLOW_REAL_DB_SWITCH=true");
    if (state.environment.runtime_mode !== "local") snippetLines.add("DS_MCP_APP_RUNTIME_MODE=local");
    if (!state.environment.database?.configured) {
      snippetLines.add("DS_MCP_SUPABASE_URL=https://<your-project>.supabase.co");
      snippetLines.add("DS_MCP_SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>");
    }
  }

  for (const issue of issues) {
    if (!issue.fix) continue;
    issue.fix.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed) snippetLines.add(trimmed);
    });
  }

  if (snippetLines.size === 0) {
    return [
      "# No missing env vars detected",
      "# The current admin session looks healthy."
    ].join("\n");
  }

  return [
    "# Suggested .env.local fix",
    ...snippetLines
  ].join("\n");
}

function renderEnvironmentModal() {
  const issues = buildEnvironmentIssues();
  const issueCount = issues.length;
  const missingCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issueCount - missingCount;
  elements.envModalTitle.textContent = `Session: ${state.user?.email || state.user?.id || "signed in"}`;

  elements.envModalSummary.innerHTML = `
    <div class="env-summary-card">
      <strong>${issueCount === 0 ? "Healthy" : summarizeCount(issueCount)}</strong>
      <span>${issueCount === 0 ? "No missing env vars or runtime errors were detected." : `${missingCount} errors, ${warningCount} warnings`}</span>
    </div>
    <div class="env-summary-card">
      <strong>${state.environment?.runtime_mode || "unknown"}</strong>
      <span>Runtime mode</span>
    </div>
    <div class="env-summary-card">
      <strong>${state.environment?.active_db_target || "unknown"}</strong>
      <span>Active DB target</span>
    </div>
  `;

  elements.envModalIssues.innerHTML = issues.length === 0
    ? `<div class="env-issue ok"><div class="env-issue-top"><strong>Everything looks configured</strong><span class="pill ok">ok</span></div><span>No missing or broken env values were detected by the live check.</span></div>`
    : issues.map((issue) => `
      <article class="env-issue ${issue.severity}">
        <div class="env-issue-top">
          <strong>${escapeHtml(issue.title)}</strong>
          <span class="pill ${issue.severity === "error" ? "danger" : "warn"}">${escapeHtml(issue.severity)}</span>
        </div>
        <span>${escapeHtml(issue.detail || "")}</span>
        ${issue.fix ? `<pre class="env-fix-snippet">${escapeHtml(issue.fix)}</pre>` : ""}
      </article>
    `).join("");

  elements.envModalFixSnippet.textContent = buildEnvironmentFixSnippet(issues);
}

async function refreshEnvironmentDiagnostics() {
  await Promise.all([loadSecurity(), loadEnvironment()]);
  renderEnvironmentModal();
}

function openEnvironmentModal() {
  renderEnvironmentModal();
  elements.envModal.hidden = false;
  elements.envModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeEnvironmentModal() {
  elements.envModal.hidden = true;
  elements.envModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

async function loadCapabilities() {
  const capabilities = await request("/api/capabilities");
  elements.apiStatus.textContent = capabilities.auth?.supabase_configured ? "supabase connected" : "supabase missing";
  elements.apiStatus.className = `pill ${capabilities.auth?.supabase_configured ? "ok" : "warn"}`;
  if (capabilities.version) {
    elements.buildVersion.textContent = capabilities.version;
    elements.loginBuildVersion.textContent = capabilities.version;
  }
}

async function loadSecurity() {
  try {
    state.security = await request("/api/security/posture");
    state.securityError = null;
  } catch (error) {
    state.security = null;
    state.securityError = error.message;
  }
  renderSecurity();
}

async function loadTaskLinks() {
  try {
    const response = await request("/api/task-links?limit=1000");
    state.links = response.links || [];
    state.linksError = null;
  } catch (error) {
    state.links = [];
    state.linksError = error.message;
  }
  renderTasks();
}

async function loadEnvironment() {
  try {
    state.environment = await request("/api/dev/environment");
    state.environmentError = null;
  } catch (error) {
    state.environment = null;
    state.environmentError = error.message;
    renderEnvironment();
    return;
  }

  renderEnvironment();
}

async function loadTasks() {
  try {
    const response = await request("/api/tasks");
    state.tasks = response.tasks || [];
    state.tasksError = null;
  } catch (error) {
    state.tasks = [];
    state.tasksError = error.message;
  }
  renderMetrics();
  renderTasks();
}

async function refreshAll() {
  if (!hasToken()) {
    syncAuthUi();
    return;
  }

  try {
    await Promise.all([loadCapabilities(), loadSecurity(), loadTasks(), loadTaskLinks()]);
    if (state.selectedTaskId) await selectTask(state.selectedTaskId);
  } catch (error) {
    showToast(error.message, true);
  }

  await loadEnvironment();
  if (!elements.envModal.hidden) {
    renderEnvironmentModal();
  }
}

function formatRelativeTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) return diffSeconds >= 0 ? "in seconds" : "seconds ago";

  const diffMinutes = Math.round(absSeconds / 60);
  if (diffMinutes < 60) return diffSeconds >= 0 ? `in ${diffMinutes}m` : `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return diffSeconds >= 0 ? `in ${diffHours}h` : `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return diffSeconds >= 0 ? `in ${diffDays}d` : `${diffDays}d ago`;
}

function maskToken(value) {
  const token = String(value || '').trim();
  if (!token) return 'unset';
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function isRunningState(value) {
  return ["agent_running", "write_running", "validation_running"].includes(value);
}

function taskFilterValue(value) {
  if (!value) return "";
  if (value === "done") return "completed";
  return value;
}

function taskMatchesFilterValue(task, value) {
  const filter = taskFilterValue(value);
  if (!filter) return true;
  if (filter === "running") return isRunningState(task.state);
  return task.state === filter;
}

function taskStatusSummary(task) {
  if (isRunningState(task.state)) return "running";
  if (task.state === "completed") return "done";
  if (task.state === "cancelled") return "cancelled";
  if (task.state === "blocked") return "blocked";
  if (task.state === "ready") return "ready";
  return task.state;
}

function taskAgentLabel(task) {
  if (task.assigned_agent_id) return task.assigned_agent_id;
  if (task.latest_run_id) return task.latest_run_id;
  if (isRunningState(task.state)) return "claimed";
  return "unassigned";
}

function taskClaimTime(task) {
  if (isRunningState(task.state) || task.state === "pending_review" || task.state === "pending_approval") {
    return task.updated_at;
  }
  return task.completed_at || task.updated_at;
}

function taskWorkflowLabel(task) {
  if (task.root_task_id && task.root_task_id !== task.id) return `root ${task.root_task_id}`;
  return task.run_count > 0 ? `runs ${task.run_count}` : "no runs";
}

function formatTaskMeta(task) {
  const parts = [
    `agent ${taskAgentLabel(task)}`,
    `claimed ${formatRelativeTime(taskClaimTime(task))}`,
    taskWorkflowLabel(task)
  ];
  return parts.join(" | ");
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

async function switchEnvironment() {
  const runtimeMode = elements.runtimeModeSelect.value;
  const dbTarget = elements.dbTargetSelect.value;

  if (!runtimeMode && !dbTarget) return;

  await request("/api/dev/environment", {
    method: "POST",
    body: JSON.stringify({
      runtime_mode: runtimeMode,
      db_target: dbTarget
    })
  });

  await loadEnvironment();
  if (!elements.envModal.hidden) {
    renderEnvironmentModal();
  }
  showToast(`Environment switched to ${runtimeMode} / ${dbTarget}`);
}

elements.loginButton.addEventListener("click", () => {
  window.location.assign("/api/admin/oauth/start");
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = elements.loginEmail.value.trim();
  const password = elements.loginPassword.value;
  if (!email || !password) {
    showToast("Enter email and password", true);
    return;
  }

  try {
    elements.loginStatus.textContent = "Signing in...";
    const response = await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    state.token = response.access_token || "";
    state.user = response.user || null;
    state.authState = "authenticated";
    elements.loginPassword.value = "";
    syncAuthUi();
    showToast("Signed in");
    await refreshAll();
  } catch (error) {
    elements.loginStatus.textContent = error.message;
    showToast(error.message, true);
  }
});

elements.logoutButton.addEventListener("click", async () => {
  state.user = null;
  state.token = "";
  state.authState = "logged_out";
  try {
    await fetch("/api/admin/logout", { method: "POST" });
  } finally {
    elements.loginEmail.value = "";
    elements.loginPassword.value = "";
    window.location.assign("/admin");
  }
});

async function restoreSession() {
  try {
    const response = await request("/api/admin/session", {
      method: "POST"
    });
    state.token = response.access_token || "";
    state.user = response.user || null;
    state.authState = "authenticated";
    syncAuthUi();
    await refreshAll();
  } catch {
    state.user = null;
    state.token = "";
    state.authState = "logged_out";
    syncAuthUi();
  }
}

elements.configButton.addEventListener("click", async () => {
  try {
    await refreshEnvironmentDiagnostics();
    openEnvironmentModal();
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.refreshButton.addEventListener("click", refreshAll);
elements.searchInput.addEventListener("input", renderTasks);
elements.stateFilter.addEventListener("change", () => {
  renderTasks();
  renderQuickFilters();
});
elements.taskListViewButton.addEventListener("click", () => {
  state.taskViewMode = "list";
  renderTasks();
});
elements.taskGraphViewButton.addEventListener("click", () => {
  state.taskViewMode = "graph";
  renderTasks();
});
document.querySelectorAll(".quick-filter").forEach((button) => {
  button.addEventListener("click", () => {
    elements.stateFilter.value = button.dataset.filter || "";
    renderTasks();
  });
});
elements.envIssuesButton.addEventListener("click", async () => {
  try {
    await refreshEnvironmentDiagnostics();
    showToast("Environment re-checked");
  } catch (error) {
    showToast(error.message, true);
  }
});
elements.environmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await switchEnvironment();
  } catch (error) {
    showToast(error.message, true);
  }
});
elements.productionPresetButton.addEventListener("click", () => {
  elements.runtimeModeSelect.value = "production";
  elements.dbTargetSelect.value = "production";
  showToast("Production preset selected. Apply to switch.");
});
elements.envModalBackdrop.addEventListener("click", closeEnvironmentModal);
elements.envModalCloseButton.addEventListener("click", closeEnvironmentModal);
elements.envModalDismissButton?.addEventListener("click", closeEnvironmentModal);
document.addEventListener("click", (event) => {
  if (elements.envModal.hidden) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-modal-close]")) {
    closeEnvironmentModal();
    return;
  }
  const modalCard = elements.envModal.querySelector(".modal-card");
  if (modalCard && !target.closest(".modal-card")) {
    closeEnvironmentModal();
  }
}, true);
elements.envModalRefreshButton.addEventListener("click", async () => {
  try {
    await refreshEnvironmentDiagnostics();
    showToast("Environment re-checked");
  } catch (error) {
    showToast(error.message, true);
  }
});
elements.envCopyFixButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.envModalFixSnippet.textContent || "");
    showToast("Fix snippet copied");
  } catch (error) {
    showToast(error.message, true);
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.envModal.hidden) {
    closeEnvironmentModal();
  }
});

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

elements.taskGraph.addEventListener("click", async (event) => {
  const node = event.target.closest("[data-task-id]");
  if (!node) return;
  try {
    await selectTask(node.dataset.taskId);
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.taskGraph.addEventListener("click", async (event) => {
  const linkItem = event.target.closest("[data-link-from]");
  if (!linkItem) return;
  try {
    await selectTask(linkItem.dataset.linkFrom);
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.mobileNavButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMobileView(button.dataset.mobileView || "progress");
  });
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

renderMobileViewport();
await loadCapabilities();
restoreSession();

window.addEventListener("resize", () => {
  renderMobileViewport();
});


