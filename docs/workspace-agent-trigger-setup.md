# Workspace Agent Trigger Setup

This document describes how to wire a backend-triggered ChatGPT Workspace Agent flow.

## Runtime flow

```text
Business backend
  -> POST /api/agent-runs
  -> ds_mcp_server calls ChatGPT Workspace Agent trigger API
  -> Workspace Agent runs in ChatGPT
  -> Agent calls callback Action
  -> POST /internal/agent-runs/{run_id}/result
  -> ds_mcp_server stores the run result
```

## Required settings

Set these values in the hosting environment:

```env
PUBLIC_BASE_URL=https://ds-mcp-server-one.vercel.app
WORKSPACE_AGENT_TRIGGER_ID=agtch_xxx
WORKSPACE_AGENT_TOKEN=<workspace-agent-bearer-value>
WORKSPACE_AGENT_CALLBACK_TOKEN=<long-random-callback-value>
WORKSPACE_AGENT_API_BASE_URL=https://api.chatgpt.com
GITHUB_MAX_FILE_BYTES=1048576
```

`WORKSPACE_AGENT_TRIGGER_ID` is the `agtch_xxx` identifier from the published API trigger channel.

## Backend trigger endpoint

```http
POST /api/agent-runs
```

Example:

```json
{
  "agent_type": "design_review",
  "request_id": "DSR-001",
  "mode": "review_only",
  "input": "Review DSR-001 and return decision, summary, risk, validation."
}
```

Expected response:

```json
{
  "ok": true,
  "run": {
    "id": "airun_xxx",
    "status": "triggered"
  }
}
```

## Read run status

```http
GET /api/agent-runs/{run_id}
```

## Agent callback Action

Configure a Custom Agent Action pointing to this server and expose only this operation for callback:

```yaml
openapi: 3.1.0
info:
  title: Workspace Agent Callback API
  version: 1.0.0
servers:
  - url: https://ds-mcp-server-one.vercel.app
paths:
  /internal/agent-runs/{run_id}/result:
    post:
      operationId: submitWorkspaceAgentRunResult
      summary: Submit completed workspace agent run result
      x-openai-isConsequential: true
      parameters:
        - name: run_id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - status
                - summary
              properties:
                status:
                  type: string
                  enum: [completed, failed]
                decision:
                  type: string
                  enum: [approve, revise, reject, unknown]
                risk_level:
                  type: string
                  enum: [low, medium, high, unknown]
                summary:
                  type: string
                validation:
                  type: array
                  items:
                    type: string
                error:
                  type: string
      responses:
        "200":
          description: Result accepted
```

Set Action authentication to API key/Bearer and use the same value as `WORKSPACE_AGENT_CALLBACK_TOKEN`.

## Agent instruction block

Add this to the Workspace Agent instructions:

```text
When triggered by backend:
- Read Run ID, Request ID, Agent type, Mode, and Callback URL from the trigger input.
- Use available tools only for the requested mode.
- When finished, call submitWorkspaceAgentRunResult.
- Include status, decision, risk_level, summary, validation, and error when blocked.
- Never expose secrets or internal credentials.
```

## Notes

The trigger API is asynchronous. The backend should treat `POST /api/agent-runs` as accepted work, then wait for the callback Action to mark the run completed or failed.
