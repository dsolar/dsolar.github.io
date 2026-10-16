-- Private, device-paired ESPN connections. No user session or league snapshot is
-- accessible with the site's public Supabase key. Only the Edge Function reads
-- these tables after checking a 256-bit connection token.
create table public.espn_sync_connections (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash)=64),
  session_cipher jsonb not null,
  status text not null default 'connected' check (status in ('connected','reconnect_required')),
  last_error jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '90 days'
);
create table public.espn_sync_leagues (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.espn_sync_connections(id) on delete cascade,
  league_id bigint not null,
  season integer not null,
  snapshot jsonb not null,
  summary jsonb not null,
  status text not null check (status in ('connected','partial','error','reconnect_required')),
  last_synced_at timestamptz not null,
  last_attempt_at timestamptz,
  next_sync_at timestamptz not null default now(),
  sync_started_at timestamptz,
  last_error jsonb,
  unique(connection_id,league_id,season)
);
create index espn_sync_leagues_due_idx on public.espn_sync_leagues(next_sync_at);
create index espn_sync_connections_expiry_idx on public.espn_sync_connections(expires_at);
create table public.espn_sync_config (name text primary key,value text not null);

alter table public.espn_sync_connections enable row level security;
alter table public.espn_sync_leagues enable row level security;
alter table public.espn_sync_config enable row level security;
revoke all on public.espn_sync_connections,public.espn_sync_leagues,public.espn_sync_config from public,anon,authenticated;
grant all on public.espn_sync_connections,public.espn_sync_leagues,public.espn_sync_config to service_role;

-- The scheduler key is generated inside Postgres and never included in source,
-- URLs, job text, browser code, or deployment output.
do $$
declare scheduler_token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  insert into public.espn_sync_config(name,value) values
    ('scheduler_token',scheduler_token),
    ('scheduler_token_hash',encode(extensions.digest(scheduler_token,'sha256'),'hex'));
end $$;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('espn-league-sync','*/20 * * * *',$job$
  select net.http_post(
    url := 'https://baxrczyufqbzrogftmyn.supabase.co/functions/v1/espn-sync?action=scheduled',
    headers := jsonb_build_object('Content-Type','application/json','X-ESPN-Scheduler',
      (select value from public.espn_sync_config where name='scheduler_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
$job$);
