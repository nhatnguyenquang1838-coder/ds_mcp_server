# AgentOps Admin UI

This adds a lightweight browser UI for the AgentOps task workflow.

## URL

After deployment, open:

```text
https://ds-mcp-server-one.vercel.app/admin/
```

The UI is a static app under:

```text
public/admin/index.html
public/admin/styles.css
public/admin/app.js
```

## Features

- View task metrics by state.
- List and filter tasks.
- Create manual tasks.
- Inspect task details.
- Apply allowed workflow transitions returned by the task API.
- Add task dependency links.
- View task links and timeline events.
- Store REST API bearer token in browser localStorage for admin API calls.

## Required backend

The UI expects the existing AgentOps API endpoints:

```text
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/{task_id}
GET    /api/tasks/{task_id}/links
POST   /api/tasks/{task_id}/links
POST   /api/tasks/{task_id}/transitions
GET    /api/tasks/{task_id}/events
```

## Configuration

If `REST_API_BEARER_TOKEN` is configured, paste the token into the UI header and click `Save token`.

The token is stored locally in the browser only. It is not sent anywhere except this server's `/api/*` endpoints as:

```text
Authorization: Bearer <token>
```

## Notes

- This is an MVP admin console, not a full RBAC product UI.
- Supabase service-role credentials remain server-side only.
- The UI uses vanilla JavaScript to avoid a new frontend build pipeline.
