create table if not exists security_rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function security_rate_limit_acquire(
  p_bucket_key text,
  p_window_ms integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  count integer,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  window_interval interval := p_window_ms * interval '1 millisecond';
  window_start timestamptz;
  request_count_value integer;
begin
  insert into public.security_rate_limit_buckets as buckets (
    bucket_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_bucket_key,
    now_ts,
    1,
    now_ts
  )
  on conflict (bucket_key) do update
    set window_started_at = case
      when buckets.window_started_at <= now_ts - window_interval then excluded.window_started_at
      else buckets.window_started_at
    end,
    request_count = case
      when buckets.window_started_at <= now_ts - window_interval then 1
      else buckets.request_count + 1
    end,
    updated_at = now_ts
  returning window_started_at, request_count
  into window_start, request_count_value;

  allowed := request_count_value <= p_max_requests;
  count := request_count_value;
  remaining := greatest(p_max_requests - request_count_value, 0);
  reset_at := window_start + window_interval;
  return next;
end;
$$;

revoke all on function public.security_rate_limit_acquire(text, integer, integer) from public;
grant execute on function public.security_rate_limit_acquire(text, integer, integer) to service_role;
