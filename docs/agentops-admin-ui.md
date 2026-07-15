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
- Sign in with Supabase Auth and store the session token in browser localStorage.

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

Admin users sign in through `/api/admin/oauth/start`, which redirects them to the configured Supabase OAuth provider and returns to `/api/admin/oauth/callback`.

The callback stores the Supabase session in an HttpOnly cookie and the browser reuses that session for admin and workflow requests.

ChatGPT custom agents should use the OAuth endpoints under `/oauth/*` and call REST endpoints with the OAuth access token.

## Admin SSO configuration

Required env vars:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_OAUTH_PROVIDER` such as `google`, `github`, or your configured provider
- `SUPABASE_ADMIN_ALLOWED_EMAILS` if you want to whitelist specific admin accounts

For local development, make sure your Supabase OAuth app allows the callback URL that the server builds from the current host, for example:

```text
http://localhost:8787/api/admin/oauth/callback
```

## Notes

- This is an MVP admin console, not a full RBAC product UI.
- Supabase service-role credentials remain server-side only.
- The UI uses vanilla JavaScript to avoid a new frontend build pipeline.
