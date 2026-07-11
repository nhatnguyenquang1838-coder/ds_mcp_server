# Design Document

## Overview

This design refines the existing static DW AgentOps Admin UI into a progress-first operational dashboard. The current page already has mobile navigation for Progress, Tasks, Assign, and Flow, plus task list/graph switching and workflow management. The implementation therefore extends current markup and render functions instead of replacing the shell.

The core design principle is evidence-based progress: summary values, attention labels, and task cues are derived only from fields already returned by the existing APIs. Overall completion may be calculated from lifecycle states, but per-task percentages are prohibited unless a canonical backend field is later introduced.

This specification is compatible with `AGENTOPS-UI-01-dashboard-cta-throttling`. It does not replace that work or remove its processing-state protections.

## Architecture

```txt
public/admin/index.html
  -> existing Progress panel
     -> ProgressSummary region
     -> NeedsAttention region
     -> ProgressPreview region
     -> secondary create/bulk-create controls
  -> existing Tasks panel
     -> filters and list/graph toggle
     -> contextual bulk toolbar
     -> existing task tree and dependency graph
  -> existing Assign panel
     -> selected task detail, transitions, links, timeline
  -> existing Flow panel
     -> workflow list and workflow detail

public/admin/app.js
  -> loadTasks / loadTaskLinks
  -> deriveProgressSummary(tasks)
  -> deriveAttentionItems(tasks, now)
  -> deriveProgressPreview(tasks, links)
  -> renderProgressDashboard()
  -> existing renderTaskList / renderTaskGraph / selectTask

public/admin/bulk.js
  -> existing selectedTaskIds
  -> renderTaskSelection()
  -> render contextual bulk-toolbar state
  -> existing bulk API calls and partial-success reporting

public/admin/styles.css
  -> progress-first visual hierarchy
  -> responsive 360px and 390px behavior
  -> contextual bulk-toolbar layout
```

No backend, database, State Engine, route-policy, authentication, or workflow contract changes are required.

## Components and Interfaces

### ProgressPanelMarkup

Suggested path:

```txt
public/admin/index.html
```

Responsibility:

- Add semantic containers for overall progress, attention items, and the progress preview inside the existing `data-mobile-panel="progress"` section.
- Place operational progress before task-creation forms.
- Preserve existing form IDs used by `app.js` and `bulk.js`.

Suggested interface:

```html
<section id="progressSummary" aria-label="Task progress summary"></section>
<section id="attentionQueue" aria-labelledby="attentionQueueTitle"></section>
<section id="progressPreview" aria-labelledby="progressPreviewTitle"></section>
```

Existing structures to reuse:

- `.panel`, `.panel-heading`, `.metrics`, `.pill`, `.empty-state`.
- Existing mobile panel and bottom-navigation attributes.

### ProgressDerivation

Suggested path:

```txt
public/admin/progress.js
```

Responsibility:

- Provide pure, deterministic helpers for normalized groups, overall summary, attention classification, and preview sorting.
- Avoid direct DOM access and network calls so behavior can be unit tested.
- Preserve unknown raw states without treating them as complete.

Suggested interface:

```js
export function normalizeTaskGroup(task) {}
export function deriveProgressSummary(tasks) {}
export function deriveAttentionItems(tasks, now = new Date()) {}
export function sortProgressPreview(tasks) {}
```

A separate helper module is preferred because `app.js` currently combines state, API, and DOM concerns. If repository evidence shows a smaller safe approach, equivalent pure helpers may remain in `app.js`, but they must stay testable.

### ProgressDashboardRenderer

Suggested path:

```txt
public/admin/app.js
```

Responsibility:

- Read `state.tasks` and render summary, attention, and preview regions.
- Reuse `escapeHtml`, date formatting, status label, agent label, and task selection behavior.
- Switch to Tasks or Assign mode when the operator opens an attention or preview item.
- Show loading, empty, and error states consistently with current Admin patterns.

Suggested interface:

```js
function renderProgressDashboard() {}
function renderProgressSummary(summary) {}
function renderAttentionQueue(items) {}
function renderProgressPreview(tasks) {}
```

### ProgressTaskCard

Suggested path:

```txt
public/admin/app.js
```

Responsibility:

- Refine `renderTaskCard(task)` and add a compact preview variant if needed.
- Prioritize title, status, priority, agent/run cue, and update time.
- Move full task ID to secondary metadata or the selected-task detail.
- Preserve `.task-card[data-task-id]`, the task tree, MutationObserver checkbox enhancement, and graph selection.

Suggested interface:

```js
function renderTaskCard(task, options = { compact: false }) {}
```

### ContextualBulkToolbar

Suggested paths:

```txt
public/admin/index.html
public/admin/bulk.js
public/admin/styles.css
```

Responsibility:

- Keep the selected task set in `bulk.js` as the source of truth.
- Render an idle selection state when nothing is selected.
- Render a compact selected-state toolbar when selection is non-empty.
- Preserve current PATCH, transition, and link payloads and partial-success feedback.
- De-emphasize delete and avoid silent force escalation.

Suggested interface:

```js
function renderTaskSelection() {}
function renderBulkToolbarState(selectedCount) {}
```

### ResponsiveProgressStyles

Suggested path:

```txt
public/admin/styles.css
```

Responsibility:

- Add progress summary, progress bar, attention list, preview card, and compact toolbar styles.
- Keep the light theme and current CSS variables.
- Ensure 360px and 390px layouts have no horizontal overflow.
- Keep technical graph content out of the initial Progress flow.

Existing styles to reuse:

- Root color variables.
- `.panel`, `.pill`, `.metric`, `.task-card`, `.mobile-nav`.

## Data Models

### NormalizedTaskGroup

```ts
type NormalizedTaskGroup =
  | 'done'
  | 'running'
  | 'blocked'
  | 'ready'
  | 'draft'
  | 'cancelled'
  | 'unknown';
```

Mapping rules:

- `completed` -> `done`.
- `agent_running`, `write_running`, `validation_running` -> `running`.
- `blocked`, `failed` -> `blocked`.
- `ready`, `pending_review`, `pending_approval` -> `ready`.
- `draft` -> `draft`.
- `cancelled` -> `cancelled`.
- Every other value -> `unknown`, preserving the raw label.

### ProgressSummary

```ts
type ProgressSummary = {
  total: number;
  actionableTotal: number;
  completed: number;
  percentComplete: number;
  ready: number;
  running: number;
  blocked: number;
  draft: number;
  cancelled: number;
  unknown: number;
};
```

Mapping rules:

- `actionableTotal = total - cancelled`.
- `percentComplete = actionableTotal > 0 ? completed / actionableTotal * 100 : 0`.
- Counts are derived from the normalized group mapping.
- Unknown states contribute to total and actionable total but not completed.

### AttentionReason

```ts
type AttentionReason =
  | 'blocked'
  | 'failed'
  | 'pending_review'
  | 'pending_approval'
  | 'idle';
```

Priority rules:

1. `failed`.
2. `blocked`.
3. `pending_approval`.
4. `pending_review`.
5. `idle`.

A task may have more than one display reason, but the renderer should choose one primary reason deterministically and may show secondary badges.

### AttentionItem

```ts
type AttentionItem = {
  taskId: string;
  title: string;
  rawState: string;
  primaryReason: AttentionReason;
  updatedAt: string | null;
  priority: string | null;
};
```

Mapping rules:

- Idle classification applies only to valid timestamps, non-terminal states, and age greater than 48 hours.
- Idle is not overdue.
- Missing titles or priorities use safe visible fallbacks.

### ProgressPreviewItem

```ts
type ProgressPreviewItem = {
  taskId: string;
  title: string;
  rawState: string;
  group: NormalizedTaskGroup;
  priority: string | null;
  agentLabel: string;
  updatedAt: string | null;
  relationCount: number;
  cue: string;
};
```

Sort rules:

1. Group order: blocked, running, ready, draft, unknown, done, cancelled.
2. Within a group, priority order: urgent, high, medium, low, unknown.
3. Then newest valid update time first.
4. Then task ID for deterministic output.

### BulkToolbarViewState

```ts
type BulkToolbarViewState = {
  selectedCount: number;
  expanded: boolean;
  showDestructiveActions: boolean;
};
```

Mapping rules:

- `expanded` is true only when `selectedCount > 0`.
- Destructive actions remain secondary even when expanded.
- A cancelled confirmation produces no request.

## Correctness Properties

### Completion denominator invariant

Cancelled tasks must never increase or decrease completed count and must be excluded from the actionable denominator.

### No fabricated progress invariant

A task must never display a numeric percentage unless that value comes from a verified canonical API field.

### Unknown-state invariant

Unknown states remain visible, count as actionable unless cancelled semantics are explicitly established, and never count as completed.

### Attention truth invariant

A task may be called overdue only when a verified due date or SLA exists. Timestamp age alone may be shown only as idle.

### Preview determinism invariant

The same task input, timestamp reference, and link input must produce the same summary, attention order, and preview order.

### Selection compatibility invariant

Refining task card markup must not break `.task-card[data-task-id]`, checkbox injection, selected-task highlighting, task-tree nesting, or card click selection.

### Mode compatibility invariant

Progress, Tasks, Assign, and Flow must remain reachable, and current task or workflow operations must remain in their existing mode unless a separately approved scope changes them.

### State isolation invariant

Progress derivation and rendering must not mutate task records, workflow records, links, claims, leases, transitions, or audit events.

### Sensitive-output invariant

No rendered progress, attention, error, test fixture, screenshot, or log may expose a bearer token or service credential.

## Error Handling

- Reuse the existing request wrapper in `app.js` so HTTP status, safe detail, and request ID remain available.
- If task loading fails, render an error state in Progress and Tasks while keeping the configuration modal reachable.
- If links fail but tasks load, render task progress and show relation counts as unavailable rather than failing the whole dashboard.
- Treat malformed timestamps as missing values and exclude them from idle classification.
- Treat missing priority, agent, run, or relation data as neutral fallbacks.
- Do not invent blocker reasons or next steps when fields are absent.
- Preserve current toast behavior for task and bulk action failures.
- A cancelled destructive confirmation must not call the delete endpoint.

## Testing Strategy

Pure logic tests:

- State-to-group mapping for every known state and an unknown state.
- Completion calculation with cancelled tasks and zero actionable tasks.
- Attention classification for blocked, failed, review, approval, valid idle, malformed date, and terminal tasks.
- Deterministic preview ordering and priority tie-breakers.
- No task-level percentage output without a canonical value.

DOM and interaction checks:

- Progress content precedes create forms on mobile.
- Clicking a preview or attention item opens the corresponding task without breaking selection.
- Task card changes preserve checkbox injection and task-tree nesting.
- Bulk toolbar stays compact at zero selection and expands after selection.
- Cancelling delete performs no request.
- Search, quick filters, list/graph toggle, selected-task detail, links, transitions, workflows, and configuration remain functional.

Responsive and accessibility checks:

- Manual smoke at desktop, 390px, and 360px.
- No horizontal overflow in Progress, Tasks, and selected-state bulk toolbar.
- Mode controls expose selected state and are keyboard reachable.
- Progress has visible and accessible text.
- Status does not rely on color alone.

Repository validation:

```bash
npm run typecheck
npm run build
npm test
```

Validation commands must be inspected and run in the policy-approved isolated environment. Existing GitHub Actions and Governance Validation results must match the current PR head before success is claimed.

## Implementation Constraints

- Modify only approved Admin UI files and directly required tests during future implementation.
- Keep this specification in `.kiro/specs/AGENTOPS-UI-02-progress-first-task-dashboard/`.
- Do not change REST/MCP API contracts, database schema, migrations, State Engine behavior, auth, route policy, rate limits, or audit behavior.
- Do not add or upgrade dependencies without a new scoped approval.
- Preserve `AGENTOPS-UI-01` CTA processing and duplicate-request protections.
- Reuse current IDs, data attributes, request helpers, state labels, and CSS variables where practical.
- Do not silently invoke force deletion. Any force path requires separately approved impact and production-data authority.
- Do not expose secrets in code, errors, tests, screenshots, diagrams, or PR text.
- Report validation honestly, including the existing Governance Validation baseline condition when relevant.
