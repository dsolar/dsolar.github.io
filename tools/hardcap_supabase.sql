-- Shared leagues for Hard Cap (davidsolar.dev/hardcap/).
-- Lives in the Supabase project "dsolar's Project" (baxrczyufqbzrogftmyn) as migration hardcap_leagues.
--
-- How it works: the whole league is one JSON document (hc_leagues.state) with a version number. The page runs the
-- rules (hardcap/engine.js), then saves the new document with the version it started from; if someone else saved in
-- between, the save is refused and the page reloads and tries again. The server's jobs are the ones the page can't
-- be trusted with: who owns which team (PINs), keeping FAAB bids sealed until they're opened, and the save order.
--
-- The page calls these with the project's public (anon/publishable) key:
--   hc_create(p_name, p_pin, p_state)                      -> {id, version}        p_pin becomes the commissioner PIN
--   hc_view(p_id, p_since)                                 -> {version, now, claims, state (null if not newer)}
--   hc_claim(p_id, p_team, p_manager, p_pin)               -> {ok, version} or {error}   claims an open team, sets its PIN
--   hc_auth(p_id, p_team, p_pin)                           -> {ok} or {error}      p_team = -1 checks the commissioner PIN
--   hc_save(p_id, p_team, p_pin, p_version, p_state, p_note, p_clear)
--                                                          -> {ok, version} or {error, version, state}
--   hc_unclaim(p_id, p_pin, p_team)                        -> {ok, version} or {error}   commissioner frees a team
--   hc_bids_put(p_id, p_team, p_pin, p_kind, p_bids)       -> {ok} or {error}      replaces a team's sealed bids
--   hc_bids_mine(p_id, p_team, p_pin, p_kind)              -> {bids}
--   hc_bids_open(p_id, p_team, p_pin, p_kind)              -> {bids: {team: [...]}} once state.due.<kind> has passed,
--                                                             or any time for the commissioner
-- p_kind is 'waiver' or 'auction'. p_clear on hc_save names a kind whose sealed bids are deleted with that save.
--
-- Every table is closed to the public (row level security with no policies); only these functions touch them.
-- PINs are 4 to 8 digits, stored as bcrypt hashes. Five wrong PINs in a row lock that seat out for 15 minutes.
-- To reset a commissioner PIN:  update hc_leagues set commish_hash = crypt('1234', gen_salt('bf', 8)) where id = '<id>';

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.hc_leagues (
  id text primary key,
  name text not null,
  commish_hash text not null,
  commish_fails int not null default 0,
  commish_wait timestamptz,
  state jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.hc_seats (
  league text not null references public.hc_leagues(id) on delete cascade,
  team int not null,
  manager text not null,
  pin_hash text not null,
  fails int not null default 0,
  wait_until timestamptz,
  claimed_at timestamptz not null default now(),
  primary key (league, team)
);
create table if not exists public.hc_sealed (
  league text not null references public.hc_leagues(id) on delete cascade,
  team int not null,
  kind text not null check (kind in ('waiver', 'auction')),
  bids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (league, team, kind)
);
create table if not exists public.hc_log (
  id bigserial primary key,
  league text not null references public.hc_leagues(id) on delete cascade,
  version int not null,
  team int not null,
  note text not null default '',
  at timestamptz not null default now()
);
create index if not exists hc_log_league on public.hc_log (league, id desc);

alter table public.hc_leagues enable row level security;
alter table public.hc_seats enable row level security;
alter table public.hc_sealed enable row level security;
alter table public.hc_log enable row level security;
revoke all on public.hc_leagues, public.hc_seats, public.hc_sealed, public.hc_log from anon, authenticated;

-- Plain text only, trimmed and capped.
create or replace function public.hc_clean(s text, n int) returns text
language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(s, ''), '[[:cntrl:]<>]', '', 'g'), '\s+', ' ', 'g')), n);
$$;

-- Null when the PIN is right for that seat (team -1 = commissioner), else the message to show.
create or replace function public.hc_pin_ok(p_id text, p_team int, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare s hc_seats; l hc_leagues;
begin
  if p_pin is null or p_pin !~ '^\d{4,8}$' then return 'PINs are 4 to 8 digits.'; end if;
  if p_team = -1 then
    select * into l from hc_leagues where id = p_id for update;
    if not found then return 'No league with that code.'; end if;
    if l.commish_wait is not null and l.commish_wait > now() then return 'Too many wrong PINs. Try again in 15 minutes.'; end if;
    if l.commish_hash <> crypt(p_pin, l.commish_hash) then
      update hc_leagues set commish_fails = l.commish_fails + 1,
        commish_wait = case when l.commish_fails + 1 >= 5 then now() + interval '15 minutes' end where id = p_id;
      return 'That''s not the commissioner PIN.';
    end if;
    if l.commish_fails > 0 then update hc_leagues set commish_fails = 0, commish_wait = null where id = p_id; end if;
    return null;
  end if;
  select * into s from hc_seats where league = p_id and team = p_team for update;
  if not found then return 'Nobody has claimed that team yet.'; end if;
  if s.wait_until is not null and s.wait_until > now() then return 'Too many wrong PINs. Try again in 15 minutes.'; end if;
  if s.pin_hash <> crypt(p_pin, s.pin_hash) then
    update hc_seats set fails = s.fails + 1, wait_until = case when s.fails + 1 >= 5 then now() + interval '15 minutes' end
      where league = p_id and team = p_team;
    return 'That''s not this team''s PIN. The commissioner can reset it.';
  end if;
  if s.fails > 0 then update hc_seats set fails = 0, wait_until = null where league = p_id and team = p_team; end if;
  return null;
end $$;

-- Owners in the stored document always come from the seats table, never from what a page sends.
create or replace function public.hc_stamp_owners(p_id text, p_state jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i int; n int; out jsonb := p_state; m text;
begin
  n := coalesce(jsonb_array_length(p_state->'teams'), 0);
  for i in 0 .. n - 1 loop
    select manager into m from hc_seats where league = p_id and team = i;
    out := jsonb_set(out, array['teams', i::text, 'owner'], coalesce(to_jsonb(m), 'null'::jsonb), true);
  end loop;
  return out;
end $$;

create or replace function public.hc_claims(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(team::text, manager), '{}'::jsonb) from hc_seats where league = p_id;
$$;

create or replace function public.hc_create(p_name text, p_pin text, p_state jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare new_id text; nm text := hc_clean(p_name, 40);
begin
  if p_pin is null or p_pin !~ '^\d{4,8}$' then return jsonb_build_object('error', 'PINs are 4 to 8 digits.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Give the league a name.'); end if;
  if jsonb_typeof(p_state->'teams') is distinct from 'array' then return jsonb_build_object('error', 'That league has no teams.'); end if;
  if octet_length(p_state::text) > 1500000 then return jsonb_build_object('error', 'That league is too big to save.'); end if;
  if (select count(*) from hc_leagues where created_at > now() - interval '1 hour') > 30 then
    return jsonb_build_object('error', 'Too many leagues created in the last hour. Try again later.');
  end if;
  loop
    new_id := lower(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=lIO0o1', ''), 1, 7));
    exit when length(new_id) = 7 and not exists (select 1 from hc_leagues where id = new_id);
  end loop;
  insert into hc_leagues (id, name, commish_hash, state)
    values (new_id, nm, crypt(p_pin, gen_salt('bf', 8)), jsonb_set(p_state, '{name}', to_jsonb(nm)));
  update hc_leagues set state = hc_stamp_owners(new_id, state) where id = new_id;
  insert into hc_log (league, version, team, note) values (new_id, 1, -1, 'League created');
  return jsonb_build_object('id', new_id, 'version', 1);
end $$;

create or replace function public.hc_view(p_id text, p_since int) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when l.id is null then jsonb_build_object('error', 'No league with that code.')
    else jsonb_build_object('version', l.version, 'now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'claims', hc_claims(l.id),
      'state', case when coalesce(p_since, 0) < l.version then l.state end) end
  from (select 1) one left join hc_leagues l on l.id = p_id;
$$;

create or replace function public.hc_claim(p_id text, p_team int, p_manager text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l hc_leagues; nm text := hc_clean(p_manager, 30);
begin
  select * into l from hc_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that code.'); end if;
  if p_team is null or p_team < 0 or p_team >= jsonb_array_length(l.state->'teams') then return jsonb_build_object('error', 'Which team?'); end if;
  if nm = '' then return jsonb_build_object('error', 'Add your name so the league knows who you are.'); end if;
  if p_pin is null or p_pin !~ '^\d{4,8}$' then return jsonb_build_object('error', 'PINs are 4 to 8 digits.'); end if;
  if exists (select 1 from hc_seats where league = p_id and team = p_team) then
    return jsonb_build_object('error', 'Someone already claimed that team.');
  end if;
  insert into hc_seats (league, team, manager, pin_hash) values (p_id, p_team, nm, crypt(p_pin, gen_salt('bf', 8)));
  update hc_leagues set state = hc_stamp_owners(p_id, state), version = version + 1, updated_at = now() where id = p_id
    returning version into l.version;
  insert into hc_log (league, version, team, note) values (p_id, l.version, p_team, nm || ' claimed a team');
  return jsonb_build_object('ok', true, 'version', l.version);
end $$;

create or replace function public.hc_auth(p_id text, p_team int, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bad text := hc_pin_ok(p_id, p_team, p_pin);
begin
  if bad is not null then return jsonb_build_object('error', bad); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.hc_save(p_id text, p_team int, p_pin text, p_version int, p_state jsonb, p_note text, p_clear text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l hc_leagues; bad text;
begin
  bad := hc_pin_ok(p_id, p_team, p_pin);
  if bad is not null then return jsonb_build_object('error', bad); end if;
  select * into l from hc_leagues where id = p_id for update;
  if l.version <> p_version then
    return jsonb_build_object('error', 'stale', 'version', l.version, 'state', l.state, 'claims', hc_claims(p_id));
  end if;
  if jsonb_typeof(p_state->'teams') is distinct from 'array'
     or jsonb_array_length(p_state->'teams') <> jsonb_array_length(l.state->'teams') then
    return jsonb_build_object('error', 'The number of teams can''t change once the league exists.');
  end if;
  if octet_length(p_state::text) > 1500000 then return jsonb_build_object('error', 'That league is too big to save.'); end if;
  update hc_leagues set state = hc_stamp_owners(p_id, p_state), version = version + 1, updated_at = now(),
    name = coalesce(nullif(hc_clean(p_state->>'name', 40), ''), name)
    where id = p_id returning version into l.version;
  if p_clear in ('waiver', 'auction') then delete from hc_sealed where league = p_id and kind = p_clear; end if;
  insert into hc_log (league, version, team, note) values (p_id, l.version, p_team, hc_clean(p_note, 200));
  return jsonb_build_object('ok', true, 'version', l.version);
end $$;

create or replace function public.hc_unclaim(p_id text, p_pin text, p_team int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bad text := hc_pin_ok(p_id, -1, p_pin); v int;
begin
  if bad is not null then return jsonb_build_object('error', bad); end if;
  delete from hc_seats where league = p_id and team = p_team;
  delete from hc_sealed where league = p_id and team = p_team;
  update hc_leagues set state = hc_stamp_owners(p_id, state), version = version + 1, updated_at = now() where id = p_id
    returning version into v;
  insert into hc_log (league, version, team, note) values (p_id, v, -1, 'Commissioner opened team ' || (p_team + 1));
  return jsonb_build_object('ok', true, 'version', v);
end $$;

create or replace function public.hc_bids_put(p_id text, p_team int, p_pin text, p_kind text, p_bids jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  if p_kind not in ('waiver', 'auction') then return jsonb_build_object('error', 'Which bids?'); end if;
  if p_team < 0 then return jsonb_build_object('error', 'Bids belong to a team.'); end if;
  if jsonb_typeof(p_bids) is distinct from 'array' or jsonb_array_length(p_bids) > 60 then
    return jsonb_build_object('error', 'Send up to 60 bids.');
  end if;
  bad := hc_pin_ok(p_id, p_team, p_pin);
  if bad is not null then return jsonb_build_object('error', bad); end if;
  insert into hc_sealed (league, team, kind, bids, updated_at) values (p_id, p_team, p_kind, p_bids, now())
    on conflict (league, team, kind) do update set bids = excluded.bids, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.hc_bids_mine(p_id text, p_team int, p_pin text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bad text := hc_pin_ok(p_id, p_team, p_pin);
begin
  if bad is not null then return jsonb_build_object('error', bad); end if;
  return jsonb_build_object('bids', coalesce((select bids from hc_sealed where league = p_id and team = p_team and kind = p_kind), '[]'::jsonb));
end $$;

create or replace function public.hc_bids_open(p_id text, p_team int, p_pin text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bad text := hc_pin_ok(p_id, p_team, p_pin); due text;
begin
  if bad is not null then return jsonb_build_object('error', bad); end if;
  select state->'due'->>p_kind into due from hc_leagues where id = p_id;
  if p_team <> -1 and (due is null or due::timestamptz > now()) then
    return jsonb_build_object('error', 'Bids stay sealed until they''re due.');
  end if;
  return jsonb_build_object('bids', coalesce((select jsonb_object_agg(team::text, bids) from hc_sealed where league = p_id and kind = p_kind), '{}'::jsonb));
end $$;

revoke all on function public.hc_pin_ok(text, int, text), public.hc_stamp_owners(text, jsonb), public.hc_claims(text),
  public.hc_clean(text, int) from public, anon, authenticated;
grant execute on function public.hc_create(text, text, jsonb), public.hc_view(text, int), public.hc_claim(text, int, text, text),
  public.hc_auth(text, int, text), public.hc_save(text, int, text, int, jsonb, text, text), public.hc_unclaim(text, text, int),
  public.hc_bids_put(text, int, text, text, jsonb), public.hc_bids_mine(text, int, text, text),
  public.hc_bids_open(text, int, text, text) to anon, authenticated;

-- ---------- Alerts and the server clock (migration hardcap_push_and_clock) ----------
-- hc_config       VAPID keys for web push and the clock's scheduler token (with its SHA-256 hash). Never public.
-- hc_push         one row per device that turned on alerts: its push subscription, league and team.
-- hc_sent         every notification already sent, so each one goes out once.
-- hc_push_subscribe(p_id, p_team, p_pin, p_sub) / hc_push_unsubscribe(p_endpoint): called by the page.
-- hc_mark_sent(p_id, p_key) and hc_system_save(p_id, p_version, p_state, p_note, p_clear): service role only, used by
-- the hardcap-clock edge function (supabase/functions/hardcap-clock), which pg_cron calls every minute:
--   select cron.schedule('hardcap-clock', '* * * * *', $job$ select net.http_post(
--     url := 'https://baxrczyufqbzrogftmyn.supabase.co/functions/v1/hardcap-clock',
--     headers := jsonb_build_object('Content-Type','application/json','X-HC-Clock',
--       (select value from public.hc_config where name='scheduler_token')),
--     body := '{}'::jsonb, timeout_milliseconds := 55000); $job$);
-- To pause the clock:   select cron.unschedule('hardcap-clock');
-- The full definitions live in the migration; the shapes match the functions above (PIN checked by hc_pin_ok).
