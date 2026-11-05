-- Site-wide account sync (assets/account.js): the daily games' saves (streaks, history, leaderboard names) follow
-- a signed-in Draft Lab account across devices. One row per key; only the owner reads or writes, through the two
-- functions below. Applied to the Supabase project as the migration ds_sync_account_data.
create table if not exists ds_sync (
  user_id uuid not null references auth.users(id) on delete cascade,
  k text not null,
  v text,
  at timestamptz not null default now(),
  primary key (user_id, k)
);
alter table ds_sync enable row level security;
create index if not exists ds_sync_at on ds_sync (user_id, at);

-- the keys the site syncs: the daily games' saves
create or replace function ds_sync_key_ok(k text) returns boolean language sql immutable as $$
  select k ~ '^(mtc\.v2\.|gtp-|jm-|sr-|tempo-)[A-Za-z0-9_.:-]{1,120}$'
$$;

-- everything changed since p_since (all of it when null); a null v means the key was removed
create or replace function ds_sync_pull(p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  return jsonb_build_object('ok', true, 'now', now(),
    'items', coalesce((select jsonb_object_agg(k, jsonb_build_object('v', v, 'at', at)) from ds_sync
      where user_id = uid and (p_since is null or at > p_since)), '{}'::jsonb));
end $$;

-- p_items { key: value (a string) or null to remove }
create or replace function ds_sync_push(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e record; n int; bad int := 0;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if jsonb_typeof(p_items) <> 'object' then return jsonb_build_object('error', 'Nothing to save.'); end if;
  if (select count(*) from jsonb_object_keys(p_items)) > 400 then return jsonb_build_object('error', 'Too many at once.'); end if;
  for e in select key, value from jsonb_each(p_items) loop
    if not ds_sync_key_ok(e.key) or (jsonb_typeof(e.value) not in ('string', 'null')) or octet_length(e.value #>> '{}') > 200000 then bad := bad + 1; continue; end if;
    insert into ds_sync (user_id, k, v, at) values (uid, e.key, e.value #>> '{}', now())
      on conflict (user_id, k) do update set v = excluded.v, at = now();
  end loop;
  select count(*) into n from ds_sync where user_id = uid;
  if n > 6000 then
    delete from ds_sync where user_id = uid and k in (select k from ds_sync where user_id = uid order by at asc limit n - 6000);
  end if;
  return jsonb_build_object('ok', true, 'now', now(), 'skipped', bad);
end $$;

revoke all on function ds_sync_pull(timestamptz) from public, anon;
revoke all on function ds_sync_push(jsonb) from public, anon;
grant execute on function ds_sync_pull(timestamptz) to authenticated;
grant execute on function ds_sync_push(jsonb) to authenticated;
