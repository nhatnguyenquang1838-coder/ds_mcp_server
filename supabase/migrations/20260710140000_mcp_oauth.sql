create table if not exists mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  grant_types text[] not null default array['authorization_code', 'refresh_token'],
  response_types text[] not null default array['code'],
  token_endpoint_auth_method text not null default 'none',
  client_secret_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists mcp_oauth_authorization_codes (
  code_hash text primary key,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  scope text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_authorization_codes_client_id
  on mcp_oauth_authorization_codes (client_id);

create index if not exists idx_mcp_oauth_authorization_codes_expires_at
  on mcp_oauth_authorization_codes (expires_at);

create table if not exists mcp_oauth_tokens (
  access_token_hash text primary key,
  refresh_token_hash text not null unique,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  scope text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_mcp_oauth_tokens_client_id
  on mcp_oauth_tokens (client_id);

create index if not exists idx_mcp_oauth_tokens_expires_at
  on mcp_oauth_tokens (expires_at);

revoke all on table mcp_oauth_clients from public;
revoke all on table mcp_oauth_authorization_codes from public;
revoke all on table mcp_oauth_tokens from public;

grant select, insert, update, delete on table mcp_oauth_clients to service_role;
grant select, insert, update, delete on table mcp_oauth_authorization_codes to service_role;
grant select, insert, update, delete on table mcp_oauth_tokens to service_role;
