# ChatGPT Custom Agent OAuth Flow

This repository supports ChatGPT custom agents through the built-in OAuth endpoints.

## Flow

1. The agent discovers metadata from `/.well-known/oauth-authorization-server`.
2. The agent registers a client at `/oauth/register` if needed.
3. The agent starts the authorization code flow at `/oauth/authorize`.
4. The agent exchanges the code at `/oauth/token`.
5. The agent calls REST endpoints with:

```text
Authorization: Bearer <oauth_access_token>
```

## Supported backend routes

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`
- `POST /oauth/register`
- `GET|POST /oauth/authorize`
- `POST /oauth/token`
- `POST /oauth/revoke`

## Recommended scopes

- `mcp` for normal MCP / REST access
- `offline_access` when the agent needs refresh tokens

## Notes

- The admin UI uses Supabase Auth for human operators.
- ChatGPT custom agents should use OAuth tokens, not the admin session token.
- Supabase service-role credentials stay server-side only.
- For Supabase SSO in the admin UI, set `SUPABASE_OAUTH_PROVIDER` to the provider you enabled in Supabase and make sure the redirect URL includes `/api/admin/oauth/callback`.
