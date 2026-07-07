# Local Runtime With Configured Supabase DB

## Goal

Support running the MCP server locally while connecting to a configured Supabase database, and provide guarded dev tools to inspect or switch the active runtime mode and database target.

## Runtime model

Runtime mode and database target are intentionally separate:

| Field | Purpose |
|---|---|
| `APP_RUNTIME_MODE` | Describes where the server process is running, such as `local`, `development`, `staging`, or `production`. |
| `SUPABASE_ACTIVE_DB_TARGET` | Selects which configured Supabase profile the process uses. |
| `DEV_TOOLS_ENABLED` | Enables guarded switch endpoints. Keep disabled by default. |
| `DEV_TOOLS_ALLOW_REAL_DB_SWITCH` | Allows switching to guarded database targets: `real`, `production`, or `prod`. |

This allows `APP_RUNTIME_MODE=local` with `SUPABASE_ACTIVE_DB_TARGET=real` for local debugging against the configured DB.

## Database profiles

The default profile is still read from existing variables:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Named profiles are optional:

```env
SUPABASE_REAL_URL=
SUPABASE_REAL_SERVICE_ROLE_KEY=
SUPABASE_LOCAL_URL=
SUPABASE_LOCAL_SERVICE_ROLE_KEY=
SUPABASE_DEVELOPMENT_URL=
SUPABASE_DEVELOPMENT_SERVICE_ROLE_KEY=
SUPABASE_STAGING_URL=
SUPABASE_STAGING_SERVICE_ROLE_KEY=
SUPABASE_PRODUCTION_URL=
SUPABASE_PRODUCTION_SERVICE_ROLE_KEY=
```

`real` falls back to `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when `SUPABASE_REAL_URL` and `SUPABASE_REAL_SERVICE_ROLE_KEY` are not set.

## Dev tool endpoints

All routes are under `/api/*`, so they are protected by `REST_API_BEARER_TOKEN` when that token is configured.

### Inspect current environment

```bash
curl http://localhost:8787/api/dev/environment
```

Response returns masked status only. It exposes the Supabase host and key-configured flags, not secret values.

### Switch runtime mode and database target

```bash
curl -X POST http://localhost:8787/api/dev/environment \
  -H "Content-Type: application/json" \
  -d '{"runtime_mode":"local","db_target":"real"}'
```

To switch to `real`, `production`, or `prod`, set:

```env
DEV_TOOLS_ALLOW_REAL_DB_SWITCH=true
```

## Safety rules

- Dev tools are disabled unless `DEV_TOOLS_ENABLED=true`.
- Switching to guarded DB targets requires `DEV_TOOLS_ALLOW_REAL_DB_SWITCH=true`.
- Secret values are not returned by status endpoints.
- Existing Supabase client cache resets naturally because the cache key changes when URL/key changes.
- Do not expose these endpoints publicly without `REST_API_BEARER_TOKEN`.
