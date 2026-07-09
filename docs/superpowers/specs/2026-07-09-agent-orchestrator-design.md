# Centralized AI Agent Distribution Platform Design Specification
**Project Goal:** To create Claude as the central orchestrator capable of reliably executing tasks by dispatching requests to specialized agents (Codex CLI, Kiro) while managing state, handling resource constraints, and enabling defined fallback logic.

---
## 🗓️ Metadata
*   **Date:** 2026-07-09
*   **Architectural Pattern:** Hybrid Transaction Manager (Recommended for MVP). Combines synchronous API Gateway control with persistent, asynchronous transaction monitoring capabilities.
*   **Primary Goal:** Maximize reliability and visibility into agent execution flow, providing a deterministic failover path from Primary $\rightarrow$ Secondary Agent.

## 🚀 Core Architectural Components

The system will be built around three major logical layers: **The Orchestration Layer (Claude)**, **The Manager/Gateway Service**, and **The Persistent State Store**.

### 1. The Orchestration Layer (Claude's Role)
Claude remains the *Intent Resolver* and *Plan Generator*. Its responsibilities are restricted to high-level reasoning, task decomposition (`TaskCreate`), and calling the central `TransactionManager` tool. It must maintain a deep understanding of when a component is required (e.g., "This needs coding," triggers `Codex`) vs. when it's needed for deeper knowledge/fallback (triggers `Kiro`).

### 2. The Hybrid Transaction Manager (The Gateway Service)
This new, critical service replaces simple direct agent calls with a centralized API that manages the *transaction lifecycle*. This is the core logic enabling fallbacks and resource checking.

**Key Functionality:**
*   **Request Ingestion:** Receives payload from Claude: `{task_id, requested_agent, context, attempt_number}`.
*   **Quota & Feasibility Check:** **CRITICAL STEP.** Before calling any agent, this service must call a specialized `ResourceService` tool (or integrate the logic):
    1.  Check `Codex` quota/status via `ResourceService`.
    2.  If insufficient: Set status to **'QUOTA_FAIL'**. Check fallback list. Proceed to Kiro if allowed by policy.
    3.  If available: Initiate call to Codex.
*   **Execution Pathing (The Fallback Chain):** This is the core state machine logic:
    1.  **Attempt 1 (Primary):** Call Primary Agent $\rightarrow$ Wait for result via callback/webhook $\rightarrow$ If successful, resolve transaction.
    2.  **Failure Detection:** If Timeout OR Resource Failure (Quota) occurs, do NOT fail immediately. Log the failure type and status.
    3.  **Attempt N (Fallback):** Execute fallback logic defined in the service configuration: Retry with lower priority agent (Kiro).
*   **Interface Definition:** The Manager exposes a standardized interface for all calling components: `transactionManager.execute(request)`.

### 3. Persistent State Store & Audit Trail (`agentRunStore` Enhancement)
The current in-memory state is insufficient for robust distribution.

*   **State Persistence (Critical Improvement):** The transaction state must be stored externally and durably, moving beyond the volatile `Map` structure. **Recommendation: Use Redis or a dedicated database table.**
    *   The store should map `transaction_id` $\rightarrow$ `{status, last_agent_called, attempts, payload, results[]}`.
*   **Observability:** The existing `auditLog` logging pattern is good but needs formal linkage to the transaction ID. Every result logged must link back to its originating `transaction_id`.

## 🏗️ Implementation Plan: Core Modules (The To-Do List)

To realize this, the following modules/files need to be created or heavily modified:

1.  **`ResourceService` (New Tool):** An API wrapper that queries usage metrics and quota limits for all registered agents (Codex/Kiro).
2.  **`TransactionManager` (Core Service Logic):** Implements the state machine, taking input from Claude and controlling flow through `ResourceService`.
3.  **State Persistence Integration:** Refactoring `agentRunStore` to use a durable backend (e.g., connecting to Redis via a wrapper).

## 🧐 Self-Review of the Specification

*   **Placeholder Check:** No generic placeholders like "TBD" or "TODO" were left in the core logic blocks; they are replaced with specific instructions (e.g., 'CRITICAL STEP', 'The Core Logic').
*   **Internal Consistency:** The components flow logically: Claude $\rightarrow$ `TransactionManager` $\rightarrow$ `ResourceService` $\rightarrow$ Agent Execution. Fallback chains depend explicitly on the state detected by both services.
*   **Scope Check:** This design is scoped narrowly to solve the reliability/fallback problem, making it manageable for a single implementation cycle. It defers large-scale decoupling (like full message queuing) until after this reliable Transaction Manager is operational.
*   **Ambiguity Check:** The most ambiguous point remains the exact *mechanism* of quota consumption—whether it's usage-based or time-based. This must be clarified with the resource owner, but for architectural design purposes, assuming a rate/count limit check is sufficient for now.

The specification is consistent and provides clear boundaries for implementation.

---
**Action Required:** Please review this technical specification. If approved, I will use the `superpowers:writing-plans` skill to create a detailed, step-by-step plan for implementing the Hybrid Transaction Manager's core components (the Router/Manager Tool).