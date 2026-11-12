-- fantasykit_more.sql
-- Objects the live Supabase database (project baxrczyufqbzrogftmyn) has that the other
-- tools/fantasykit*.sql files don't: 4 tables, 2 columns + 1 index on fk_leagues,
-- 27 functions, 2 triggers, and their grants. Exported read-only on 2026-11-12.
-- Run after fantasykit_supabase.sql (needs fk_leagues, fk_seats, fk_outbox, fk_clean,
-- fk_rand, fk_stamp, fk_token_ok). Meant to be idempotent-ish: create table if not exists,
-- add column if not exists, create or replace function, drop trigger if exists first.
-- Function bodies are copied exactly from pg_get_functiondef. No data rows.

-- ---------- tables ----------

-- fk_leagues: run-it-back series (fk_rematch, fk_series)
alter table public.fk_leagues add column if not exists series text;
alter table public.fk_leagues add column if not exists series_n integer;
create index if not exists fk_leagues_series on public.fk_leagues using btree (series, series_n);

-- fk_profiles: one name + photo per user, shown across leagues (fk_profile_me, fk_profile_set, fk_faces, fk_seat_name)
create table if not exists public.fk_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  photo text,
  updated_at timestamptz not null default now(),
  primary key (user_id)
);

-- fk_usernames: username sign-in (fk_username_*, fk_login_email, fk_new_user_username)
create table if not exists public.fk_usernames (
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  primary key (user_id)
);
create unique index if not exists fk_usernames_lower on public.fk_usernames using btree (lower(username));

-- fk_sealed: sealed pre-draft entries, kind 'cap' or 'rank' (fk_seal_*)
create table if not exists public.fk_sealed (
  league text not null references public.fk_leagues(id) on delete cascade,
  kind text not null,
  team integer not null,
  data jsonb not null,
  at timestamptz not null default now(),
  primary key (league, kind, team)
);

-- fk_heist: sealed heist moves per round (fk_heist_*)
create table if not exists public.fk_heist (
  league text not null references public.fk_leagues(id) on delete cascade,
  round bigint not null,
  team integer not null,
  moves jsonb not null,
  at timestamptz not null default now(),
  primary key (league, round, team)
);

-- RLS on, no policies: only the security definer functions touch these
alter table public.fk_profiles enable row level security;
alter table public.fk_usernames enable row level security;
alter table public.fk_sealed enable row level security;
alter table public.fk_heist enable row level security;
revoke all on table public.fk_profiles, public.fk_usernames, public.fk_sealed, public.fk_heist from public, anon, authenticated;
grant all on table public.fk_profiles, public.fk_usernames, public.fk_sealed, public.fk_heist to service_role;

-- ---------- functions ----------

CREATE OR REPLACE FUNCTION public.fk_username_ok(p text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select coalesce(p, '') ~ '^[A-Za-z0-9_.-]{3,20}$' $function$;

CREATE OR REPLACE FUNCTION public.fk_seal_due(d jsonb, k text)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
AS $function$ select case when k = 'cap' then (d->'cap'->>'due')::bigint when k = 'rank' then (d->'sealed'->>'due')::bigint else null end $function$;

CREATE OR REPLACE FUNCTION public.fk_event_data(e jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when jsonb_typeof(e->'data') = 'object' and octet_length((e->'data')::text) <= 20000 then e->'data' end
$function$;

CREATE OR REPLACE FUNCTION public.fk_seal_open(p_id text, k text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(team::text, data), '{}'::jsonb) from fk_sealed where league = p_id and kind = k
$function$;

CREATE OR REPLACE FUNCTION public.fk_heist_moves(p_id text, l_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare h jsonb := l_draft->'heist'; rnd bigint; due boolean;
begin
  if h is null or l_draft->>'phase' <> 'heist' then return null; end if;
  rnd := (h->>'at')::bigint;
  due := (extract(epoch from now()) * 1000)::bigint >= coalesce((h->>'ends')::bigint, 0)
    or not exists (
      select 1 from jsonb_array_elements(h->'pairs') p, jsonb_array_elements_text(p) t
      where exists (select 1 from fk_seats s where s.league = p_id and s.team = t::int)
        and not exists (select 1 from fk_heist x where x.league = p_id and x.round = rnd and x.team = t::int)
        and coalesce(h->'moves'->t->>'sealed', '') <> 'true' and h->'moves'->t is null);
  if not due then return null; end if;
  return coalesce((select jsonb_object_agg(team::text, moves) from fk_heist where league = p_id and round = rnd), '{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_card(l fk_leagues, t integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with games as (
    select k::int as wk, g
    from jsonb_each(case when jsonb_typeof(l.league->'results') = 'object' then l.league->'results' else '{}'::jsonb end) r(k, v),
      jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) g
    where t is not null and k ~ '^\d+$' and k::int <= coalesce((l.league->'settings'->>'weeks')::int, 99)
  ),
  rec as (
    select
      count(*) filter (where ((g->>'a')::int = t and g->>'w' = 'a') or ((g->>'b')::int = t and g->>'w' = 'b')) as w,
      count(*) filter (where ((g->>'a')::int = t and g->>'w' = 'b') or ((g->>'b')::int = t and g->>'w' = 'a')) as lo,
      count(*) filter (where ((g->>'a')::int = t or (g->>'b')::int = t) and g->>'w' = 't') as ti
    from games
  ),
  scores as (
    select wk, (g->>'a')::int as team, (g->>'sa')::numeric as sc from games
    union all select wk, (g->>'b')::int, (g->>'sb')::numeric from games
  ),
  med as (
    select s.wk, s.sc, m.m from scores s
    join (select wk, percentile_cont(0.5) within group (order by sc) as m from scores group by wk) m on m.wk = s.wk
    where s.team = t and coalesce((l.league->'settings'->>'median')::boolean, false)
  ),
  mrec as (select count(*) filter (where sc > m) as w, count(*) filter (where sc < m) as lo, count(*) filter (where sc = m) as ti from med)
  select jsonb_build_object(
    'teamName', case when t is null then null else coalesce(l.league, l.draft)->'teams'->t->>'name' end,
    'teams', jsonb_array_length(coalesce(coalesce(l.league, l.draft)->'teams', '[]'::jsonb)),
    'claimed', (select count(*) from fk_seats where league = l.id),
    'week', (l.league->>'week')::int,
    'weeks', (l.league->'settings'->>'weeks')::int,
    'playoffWeeks', coalesce((l.league->'settings'->>'playoffWeeks')::int, 0),
    'format', l.league->'settings'->>'format',
    'start', (l.league->>'start')::bigint,
    'alive', case when t is null or jsonb_typeof(l.league->'alive') <> 'array' then null else (l.league->'alive') @> to_jsonb(t) end,
    'picks', (select count(*) from jsonb_array_elements(case when jsonb_typeof(l.draft->'board') = 'array' then l.draft->'board' else '[]'::jsonb end) x where jsonb_typeof(x) = 'object'),
    'total', case when jsonb_typeof(l.draft->'order') = 'array' then jsonb_array_length(l.draft->'order') else null end,
    'w', r.w + m.w, 'l', r.lo + m.lo, 't', r.ti + m.ti)
  from rec r, mrec m;
$function$;

CREATE OR REPLACE FUNCTION public.fk_clock_heist(p_token text, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l fk_leagues;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  return jsonb_build_object('ok', true, 'open', fk_heist_moves(p_id, l.draft));
end $function$;

CREATE OR REPLACE FUNCTION public.fk_clock_seal(p_token text, p_id text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  return jsonb_build_object('ok', true, 'open', fk_seal_open(p_id, p_kind));
end $function$;

CREATE OR REPLACE FUNCTION public.fk_delete(p_id text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if l.commish <> uid then return jsonb_build_object('error', 'Only the commissioner can delete the league.'); end if;
  if btrim(coalesce(p_name, '')) <> l.name then return jsonb_build_object('error', 'Type the league''s name exactly to delete it.'); end if;
  delete from fk_leagues where id = p_id;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_dues_claim(p_id text, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); mine int; d jsonb;
begin
  select team into mine from fk_seats where league = p_id and user_id = uid;
  if mine is null then return jsonb_build_object('error', 'You don''t have a team in this league.'); end if;
  select coalesce(dues, '{}'::jsonb) into d from fk_leagues where id = p_id for update;
  if p_on then d := jsonb_set(d, '{claimed}', coalesce(d->'claimed', '{}'::jsonb) || jsonb_build_object(mine::text, (extract(epoch from now()) * 1000)::bigint));
  else d := jsonb_set(d, '{claimed}', coalesce(d->'claimed', '{}'::jsonb) - mine::text); end if;
  update fk_leagues set dues = d where id = p_id;
  return jsonb_build_object('ok', true, 'dues', d);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_dues_set(p_id text, p_dues jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l fk_leagues; uid uuid := auth.uid(); d jsonb;
begin
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if uid is null or uid <> l.commish then return jsonb_build_object('error', 'Only the commissioner can change dues.'); end if;
  if p_dues is null or jsonb_typeof(p_dues) <> 'object' or length(p_dues::text) > 6000 then return jsonb_build_object('error', 'That dues setup is too long.'); end if;
  d := coalesce(l.dues, '{}'::jsonb) || p_dues;
  update fk_leagues set dues = d where id = p_id;
  return jsonb_build_object('ok', true, 'dues', d);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_faces(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if not exists (select 1 from fk_seats where league = p_id and user_id = uid) and uid <> l.commish then
    return jsonb_build_object('ok', true, 'faces', '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'faces', coalesce((select jsonb_object_agg(s.team::text, jsonb_build_object('name', s.manager, 'photo', p.photo, 'at', extract(epoch from p.updated_at)::bigint))
    from fk_seats s join fk_profiles p on p.user_id = s.user_id where s.league = p_id), '{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fk_heist_get(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; t int; rnd bigint;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select team into t from fk_seats where league = p_id and user_id = uid;
  if t is null and uid <> l.commish then return jsonb_build_object('error', 'Only managers in this league can see this.'); end if;
  rnd := (l.draft->'heist'->>'at')::bigint;
  return jsonb_build_object('ok', true,
    'mine', (select moves from fk_heist where league = p_id and round = rnd and team = t),
    'open', fk_heist_moves(p_id, l.draft));
end $function$;

CREATE OR REPLACE FUNCTION public.fk_heist_lock(p_id text, p_moves jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; t int; h jsonb; rnd bigint; ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select team into t from fk_seats where league = p_id and user_id = uid;
  if t is null then return jsonb_build_object('error', 'Only managers in this league can make moves.'); end if;
  h := l.draft->'heist';
  if h is null or l.draft->>'phase' <> 'heist' then return jsonb_build_object('error', 'The heist is over.'); end if;
  if not exists (select 1 from jsonb_array_elements(h->'pairs') p, jsonb_array_elements_text(p) x where x::int = t) then
    return jsonb_build_object('error', 'You sit this one out: no opponent this week.');
  end if;
  if ms > coalesce((h->>'ends')::bigint, 0) + 5000 then return jsonb_build_object('error', 'Time ran out.'); end if;
  rnd := (h->>'at')::bigint;
  if h->'moves'->(t::text) is not null or exists (select 1 from fk_heist where league = p_id and round = rnd and team = t) then
    return jsonb_build_object('error', 'Your moves are locked in.');
  end if;
  if jsonb_typeof(p_moves) <> 'object' or octet_length(p_moves::text) > 2000 then return jsonb_build_object('error', 'Those moves don''t look right.'); end if;
  insert into fk_heist (league, round, team, moves)
    values (p_id, rnd, t, jsonb_build_object('shield', coalesce(p_moves->'shield', '[]'), 'steal', coalesce(p_moves->'steal', '[]'), 'jinx', coalesce(p_moves->'jinx', '[]')));
  update fk_leagues set draft = jsonb_set(draft, array['heist', 'moves', t::text], jsonb_build_object('sealed', true, 'at', ms), true),
    version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_login_email(p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select u.email from fk_usernames n join auth.users u on u.id = n.user_id where lower(n.username) = lower(p_username) limit 1
$function$;

CREATE OR REPLACE FUNCTION public.fk_new_user_username()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if fk_username_ok(new.raw_user_meta_data->>'username') then
    insert into fk_usernames (user_id, username) values (new.id, new.raw_user_meta_data->>'username') on conflict do nothing;
  end if;
  return new;
exception when others then return new;
end $function$;

CREATE OR REPLACE FUNCTION public.fk_profile_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); p fk_profiles; fallback text; un text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select username into un from fk_usernames where user_id = uid;
  select * into p from fk_profiles where user_id = uid;
  if found then return jsonb_build_object('ok', true, 'name', p.name, 'photo', p.photo, 'saved', true, 'username', un); end if;
  select manager into fallback from fk_seats where user_id = uid order by joined_at desc limit 1;
  return jsonb_build_object('ok', true, 'name', coalesce(fallback, ''), 'photo', null, 'saved', false, 'username', un);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_profile_set(p_name text, p_photo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); n text := fk_clean(p_name, 24); lid text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if n is null or n = '' then return jsonb_build_object('error', 'Add your name.'); end if;
  if p_photo is not null and (p_photo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or length(p_photo) > 90000) then
    return jsonb_build_object('error', 'That photo is too big or not an image.');
  end if;
  insert into fk_profiles (user_id, name, photo, updated_at) values (uid, n, p_photo, now())
    on conflict (user_id) do update set name = excluded.name, photo = excluded.photo, updated_at = now();
  update fk_seats set manager = n where user_id = uid and manager is distinct from n;
  for lid in select distinct league from fk_seats where user_id = uid loop
    update fk_leagues set draft = fk_stamp(lid, draft), league = fk_stamp(lid, league), version = version + 1, updated_at = now() where id = lid;
  end loop;
  return jsonb_build_object('ok', true, 'name', n);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_rematch(p_id text, p_draft jsonb, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; s text; n int; got text; new_id text; inv text := fk_rand(6); nm text; who text; at text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if uid <> l.commish and not exists (select 1 from fk_seats where league = p_id and user_id = uid) then return jsonb_build_object('error', 'Only the league''s managers can run it back.'); end if;
  s := coalesce(l.series, l.id); n := coalesce(l.series_n, 1) + 1;
  select id into got from fk_leagues where series = s and series_n = n limit 1;
  if got is not null then return jsonb_build_object('ok', true, 'id', got, 'existed', true); end if;
  if p_draft is null or jsonb_typeof(p_draft->'teams') is distinct from 'array' or jsonb_array_length(p_draft->'teams') < coalesce((select max(team) + 1 from fk_seats where league = p_id), 2) then
    return jsonb_build_object('error', 'Next week''s game needs every team from this one.');
  end if;
  if octet_length(p_draft::text) > 1500000 then return jsonb_build_object('error', 'That league is too big to save.'); end if;
  nm := coalesce(nullif(fk_clean(p_name, 40), ''), l.name);
  loop new_id := fk_rand(8); exit when not exists (select 1 from fk_leagues where id = new_id); end loop;
  update fk_leagues set series = s, series_n = coalesce(series_n, 1) where id = p_id;
  insert into fk_leagues (id, name, sport, commish, invite, draft, series, series_n) values (new_id, nm, l.sport, l.commish, inv, p_draft, s, n);
  insert into fk_seats (league, team, user_id, email, manager, notify)
    select new_id, team, user_id, email, manager, notify from fk_seats where league = p_id;
  update fk_leagues set draft = fk_stamp(new_id, draft), dues = case when l.dues is null then null else l.dues - 'paid' - 'claimed' end where id = new_id;
  select manager into who from fk_seats where league = p_id and user_id = uid;
  at := case when jsonb_typeof(p_draft->'startAt') = 'number'
    then to_char(to_timestamp((p_draft->>'startAt')::numeric / 1000) at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' ET' else null end;
  insert into fk_outbox (league, team, kind, subject, body, data)
    select new_id, x.team, 'draft', fk_clean(nm || ': next week''s game is up', 120),
      coalesce(who, 'Someone') || ' ran it back: same group, game ' || n || coalesce(', ' || (p_draft->'season'->'slate'->>'label'), '') || '. '
        || case when at is not null then 'The draft starts on its own at ' || at || '.' else 'Jump in the draft room and set your queue.' end
        || E'\n\nOpen the game: https://davidsolar.dev/fantasy-kit/play.html?id=' || new_id, null
    from fk_seats x where x.league = new_id and x.notify and x.user_id <> uid;
  return jsonb_build_object('ok', true, 'id', new_id, 'series_n', n);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_resize(p_id text, p_version integer, p_draft jsonb, p_map jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; s record;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if l.commish <> uid then return jsonb_build_object('error', 'Only the commissioner can change the teams.'); end if;
  if l.league is not null or coalesce(l.draft->>'phase', 'setup') <> 'setup' then return jsonb_build_object('error', 'Teams can only change before the draft starts.'); end if;
  if l.version <> p_version then return jsonb_build_object('error', 'stale', 'version', l.version, 'draft', l.draft, 'league', l.league); end if;
  if jsonb_typeof(p_draft->'teams') is distinct from 'array' or jsonb_array_length(p_draft->'teams') < 2 or jsonb_array_length(p_draft->'teams') > 20 then
    return jsonb_build_object('error', 'A league has 2 to 20 teams.');
  end if;
  for s in select * from fk_seats where league = p_id loop
    if not (p_map ? s.team::text) then return jsonb_build_object('error', 'Free that team first: a manager has it.'); end if;
  end loop;
  update fk_seats set team = -1 - (p_map->>(team::text))::int where league = p_id;
  update fk_seats set team = -1 - team where league = p_id;
  update fk_leagues set draft = fk_stamp(p_id, p_draft), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_seal_get(p_id text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; t int; due bigint; ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select team into t from fk_seats where league = p_id and user_id = uid;
  if t is null and uid <> l.commish then return jsonb_build_object('error', 'Only managers in this league can see this.'); end if;
  due := fk_seal_due(l.draft, p_kind);
  return jsonb_build_object('ok', true, 'mine', (select data from fk_sealed where league = p_id and kind = p_kind and team = t),
    'open', case when due is not null and ms >= due then fk_seal_open(p_id, p_kind) else null end);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_seal_set(p_id text, p_kind text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; t int; due bigint; ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if p_kind not in ('cap', 'rank') then return jsonb_build_object('error', 'Unknown entry.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select team into t from fk_seats where league = p_id and user_id = uid;
  if t is null then return jsonb_build_object('error', 'Only managers in this league can enter.'); end if;
  due := fk_seal_due(l.draft, p_kind);
  if due is null or l.draft->>'phase' <> 'setup' then return jsonb_build_object('error', 'Entries are closed.'); end if;
  if ms >= due then return jsonb_build_object('error', 'Time''s up: entries are locked.'); end if;
  if jsonb_typeof(p_data) <> 'array' or octet_length(p_data::text) > 20000 then return jsonb_build_object('error', 'That entry doesn''t look right.'); end if;
  insert into fk_sealed (league, kind, team, data, at) values (p_id, p_kind, t, p_data, now())
    on conflict (league, kind, team) do update set data = excluded.data, at = now();
  -- everyone can see who's in, not what they picked
  update fk_leagues set draft = jsonb_set(draft, array['entered', t::text], to_jsonb(ms), true), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_seat_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n text;
begin
  if new.user_id is not null then
    select name into n from fk_profiles where user_id = new.user_id;
    if n is not null and n <> '' then new.manager := n; end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.fk_series(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; s text;
begin
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if uid is null or (uid <> l.commish and not exists (select 1 from fk_seats where league = p_id and user_id = uid)) then return jsonb_build_object('error', 'Only the league''s managers can see its series.'); end if;
  s := coalesce(l.series, l.id);
  return jsonb_build_object('ok', true, 'series', s, 'weeks', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'n', coalesce(x.series_n, 1), 'name', x.name, 'at', (extract(epoch from x.created_at) * 1000)::bigint,
      'label', coalesce(x.draft->'season'->'slate'->>'label', x.draft->'season'->'showdown'->>'label'),
      'done', x.league is not null and (x.league->>'week')::int > coalesce((x.league->'settings'->>'weeks')::int, 1) + coalesce((x.league->'settings'->>'playoffWeeks')::int, 0),
      'teams', (select jsonb_agg(t->>'name') from jsonb_array_elements(coalesce(x.league, x.draft)->'teams') t),
      'scores', (select jsonb_object_agg(k, v) from (
          select distinct on (k) k, v from (
            select g->>'a' as k, (g->>'sa')::numeric as v from jsonb_array_elements(case when jsonb_typeof(x.league->'results'->'1') = 'array' then x.league->'results'->'1' else '[]'::jsonb end) g
            union all select g->>'b', (g->>'sb')::numeric from jsonb_array_elements(case when jsonb_typeof(x.league->'results'->'1') = 'array' then x.league->'results'->'1' else '[]'::jsonb end) g
          ) q order by k) z)
    ) order by coalesce(x.series_n, 1)) from fk_leagues x where x.id = l.id or (x.series is not null and x.series = s)), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fk_team_name(p_id text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); mine int; l fk_leagues; tn text := fk_clean(p_name, 28);
begin
  select team into mine from fk_seats where league = p_id and user_id = uid;
  if mine is null then return jsonb_build_object('error', 'You don''t have a team in this league.'); end if;
  if coalesce(tn, '') = '' then return jsonb_build_object('error', 'Add a team name.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if l.draft is not null and jsonb_array_length(l.draft->'teams') > mine then l.draft := jsonb_set(l.draft, array['teams', mine::text, 'name'], to_jsonb(tn)); end if;
  if l.league is not null and jsonb_array_length(l.league->'teams') > mine then l.league := jsonb_set(l.league, array['teams', mine::text, 'name'], to_jsonb(tn)); end if;
  update fk_leagues set draft = l.draft, league = l.league, version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_username_free(p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not fk_username_ok(p_username) then return jsonb_build_object('ok', false, 'why', 'Use 3 to 20 letters, numbers, dots, dashes or underscores.'); end if;
  if exists (select 1 from fk_usernames where lower(username) = lower(p_username) and user_id is distinct from auth.uid()) then
    return jsonb_build_object('ok', false, 'why', 'That username is taken.');
  end if;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_username_set(p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if not fk_username_ok(p_username) then return jsonb_build_object('error', 'Use 3 to 20 letters, numbers, dots, dashes or underscores.'); end if;
  if exists (select 1 from fk_usernames where lower(username) = lower(p_username) and user_id <> uid) then return jsonb_build_object('error', 'That username is taken.'); end if;
  insert into fk_usernames (user_id, username) values (uid, p_username) on conflict (user_id) do update set username = excluded.username;
  return jsonb_build_object('ok', true, 'username', p_username);
end $function$;

-- ---------- triggers ----------

drop trigger if exists fk_username_on_signup on auth.users;
CREATE TRIGGER fk_username_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION fk_new_user_username();

drop trigger if exists fk_seat_name on public.fk_seats;
CREATE TRIGGER fk_seat_name BEFORE INSERT ON public.fk_seats FOR EACH ROW EXECUTE FUNCTION fk_seat_name();

-- ---------- grants (EXECUTE as the live database has it; postgres owns all) ----------

revoke all on function public.fk_username_ok(text) from public, anon, authenticated, service_role;
grant execute on function public.fk_username_ok(text) to public, anon, authenticated, service_role;
revoke all on function public.fk_seal_due(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_seal_due(jsonb, text) to public, anon, authenticated, service_role;
revoke all on function public.fk_event_data(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fk_event_data(jsonb) to service_role;
revoke all on function public.fk_seal_open(text, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_seal_open(text, text) to service_role;
revoke all on function public.fk_heist_moves(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fk_heist_moves(text, jsonb) to service_role;
revoke all on function public.fk_card(fk_leagues, integer) from public, anon, authenticated, service_role;
grant execute on function public.fk_card(fk_leagues, integer) to service_role;
revoke all on function public.fk_clock_heist(text, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_clock_heist(text, text) to public, anon, authenticated, service_role;
revoke all on function public.fk_clock_seal(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_clock_seal(text, text, text) to anon, service_role;
revoke all on function public.fk_delete(text, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_delete(text, text) to anon, authenticated, service_role;
revoke all on function public.fk_dues_claim(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.fk_dues_claim(text, boolean) to authenticated, service_role;
revoke all on function public.fk_dues_set(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fk_dues_set(text, jsonb) to authenticated, service_role;
revoke all on function public.fk_faces(text) from public, anon, authenticated, service_role;
grant execute on function public.fk_faces(text) to authenticated, service_role;
revoke all on function public.fk_heist_get(text) from public, anon, authenticated, service_role;
grant execute on function public.fk_heist_get(text) to authenticated, service_role;
revoke all on function public.fk_heist_lock(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fk_heist_lock(text, jsonb) to authenticated, service_role;
revoke all on function public.fk_login_email(text) from public, anon, authenticated, service_role;
grant execute on function public.fk_login_email(text) to service_role;
revoke all on function public.fk_new_user_username() from public, anon, authenticated, service_role;
grant execute on function public.fk_new_user_username() to service_role;
revoke all on function public.fk_profile_me() from public, anon, authenticated, service_role;
grant execute on function public.fk_profile_me() to authenticated, service_role;
revoke all on function public.fk_profile_set(text, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_profile_set(text, text) to authenticated, service_role;
revoke all on function public.fk_rematch(text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_rematch(text, jsonb, text) to authenticated, service_role;
revoke all on function public.fk_resize(text, integer, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fk_resize(text, integer, jsonb, jsonb) to anon, authenticated, service_role;
revoke all on function public.fk_seal_get(text, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_seal_get(text, text) to authenticated, service_role;
revoke all on function public.fk_seal_set(text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fk_seal_set(text, text, jsonb) to authenticated, service_role;
revoke all on function public.fk_seat_name() from public, anon, authenticated, service_role;
grant execute on function public.fk_seat_name() to service_role;
revoke all on function public.fk_series(text) from public, anon, authenticated, service_role;
grant execute on function public.fk_series(text) to authenticated, service_role;
revoke all on function public.fk_team_name(text, text) from public, anon, authenticated, service_role;
grant execute on function public.fk_team_name(text, text) to authenticated, service_role;
revoke all on function public.fk_username_free(text) from public, anon, authenticated, service_role;
grant execute on function public.fk_username_free(text) to public, anon, authenticated, service_role;
revoke all on function public.fk_username_set(text) from public, anon, authenticated, service_role;
grant execute on function public.fk_username_set(text) to authenticated, service_role;
