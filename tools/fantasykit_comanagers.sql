-- Draft Lab co-managers: a team can have a manager plus up to two co-managers. A co-manager has a seat like
-- anyone else (fk_seats, co = true), so every move, lineup, trade and chat check that looks a manager up by
-- user_id works for him unchanged, and the outbox sends each alert to every manager of the team who has email
-- alerts on (and to their phones). The team's manager invites one with a link (fk_co_invite); the manager or the
-- commissioner can remove one, and a co-manager can leave (fk_co_remove). When the manager leaves, the longest-
-- serving co-manager takes the team over (fk_seat_promote). The commissioner freeing a team clears all its seats.
-- Names: a team's "owner" (fk_stamp) and the seat map read "Alice & Bob".
-- Run after fantasykit_supabase.sql and fantasykit_more.sql. Not in promotion and relegation pyramids.

alter table public.fk_seats add column if not exists co boolean not null default false;
alter table public.fk_seats drop constraint if exists fk_seats_pkey;
alter table public.fk_seats drop constraint if exists fk_seats_league_user_id_key;
alter table public.fk_seats add primary key (league, user_id);
create unique index if not exists fk_seats_owner on public.fk_seats (league, team) where not co;

create table if not exists public.fk_co_invites (
  league text not null references public.fk_leagues(id) on delete cascade,
  team int not null,
  code text not null,
  created_at timestamptz not null default now(),
  primary key (league, team)
);
alter table public.fk_co_invites enable row level security;   -- no policies: only the functions below touch it
revoke all on public.fk_co_invites from anon, authenticated;

-- the manager left (or deleted his account): his longest-serving co-manager takes the team
create or replace function public.fk_seat_promote() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not old.co and not exists (select 1 from fk_seats where league = old.league and team = old.team and not co) then
    update fk_seats set co = false where league = old.league and user_id =
      (select user_id from fk_seats where league = old.league and team = old.team and co order by joined_at limit 1);
  end if;
  return null;
end $$;
drop trigger if exists fk_seat_promote on public.fk_seats;
create trigger fk_seat_promote after delete on public.fk_seats for each row execute function fk_seat_promote();

-- names: the manager first, then co-managers in the order they joined
CREATE OR REPLACE FUNCTION public.fk_seat_map(p_id text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(team::text, names), '{}'::jsonb) from (
    select team, string_agg(manager, ' & ' order by co, joined_at) as names from fk_seats where league = p_id group by team) x;
$function$;

CREATE OR REPLACE FUNCTION public.fk_stamp(p_id text, p_doc jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare i int; n int; out jsonb := p_doc; m text;
begin
  if p_doc is null then return null; end if;
  n := coalesce(jsonb_array_length(p_doc->'teams'), 0);
  for i in 0 .. n - 1 loop
    select string_agg(manager, ' & ' order by co, joined_at) into m from fk_seats where league = p_id and team = i;
    out := jsonb_set(out, array['teams', i::text, 'owner'], coalesce(to_jsonb(m), 'null'::jsonb), true);
  end loop;
  return out;
end $function$;

-- every manager of the team with email alerts on gets the alert (an emailed invite goes to its one address)
CREATE OR REPLACE FUNCTION public.fk_outbox_take(p_token text, p_limit integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  with picked as (
    select o.id from fk_outbox o where o.sent_at is null and o.tries < 4 order by o.created_at limit least(coalesce(p_limit, 20), 50) for update skip locked
  ), bumped as (
    update fk_outbox o set tries = o.tries + 1 from picked where o.id = picked.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'league', b.league, 'league_name', l.name, 'sport', l.sport, 'team', b.team, 'kind', b.kind,
    'subject', b.subject, 'body', b.body, 'data', b.data, 'email', coalesce(b.to_email, s.email), 'manager', coalesce(b.to_name, s.manager),
    'push', case when b.to_email is not null then '[]'::jsonb else (select coalesce(jsonb_agg(p.sub), '[]'::jsonb) from fk_push p where p.user_id = s.user_id) end)), '[]'::jsonb) into out
  from bumped b join fk_leagues l on l.id = b.league
    left join fk_seats s on s.league = b.league and s.team = b.team and (case when b.to_email is not null then not s.co else s.notify end);
  return jsonb_build_object('emails', out);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_contacts(p_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare l fk_leagues;
begin
  select * into l from fk_leagues where id = p_id;
  if l.id is null or l.commish is distinct from auth.uid() then return jsonb_build_object('error', 'Only the commissioner can see managers'' email addresses.'); end if;
  return jsonb_build_object('ok', true, 'teams', coalesce((
    select jsonb_object_agg(t.team, jsonb_build_object('email', c.email, 'name', c.name, 'invited_at', c.invited_at, 'invites', coalesce(c.invites, 0), 'account', s.email, 'manager', s.manager))
    from (select team from fk_contacts where league = p_id union select team from fk_seats where league = p_id) t
    left join fk_contacts c on c.league = p_id and c.team = t.team left join fk_seats s on s.league = p_id and s.team = t.team and not s.co), '{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fk_faces(p_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    from fk_seats s join fk_profiles p on p.user_id = s.user_id where s.league = p_id and not s.co), '{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fk_join(p_id text, p_invite text, p_team integer, p_manager text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; mg text := fk_clean(p_manager, 24); n int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if l.invite <> coalesce(p_invite, '') then return jsonb_build_object('error', 'That invite code doesn''t match. Ask the commissioner for a new link.'); end if;
  if exists (select 1 from fk_seats where league = p_id and user_id = uid) then return jsonb_build_object('error', 'You already have a team in this league.'); end if;
  if exists (select 1 from fk_pyramids p join fk_seats s on s.league in (p.top, p.bot) where (p.top = p_id or p.bot = p_id) and s.user_id = uid) then
    return jsonb_build_object('error', 'You already have a team in the other tier. One team per manager in a promotion and relegation pyramid.');
  end if;
  n := jsonb_array_length(l.draft->'teams');
  if p_team is null or p_team < 0 or p_team >= n then return jsonb_build_object('error', 'Pick a team.'); end if;
  if exists (select 1 from fk_seats where league = p_id and team = p_team and not co) then return jsonb_build_object('error', 'Someone already took that team.'); end if;
  if mg = '' then return jsonb_build_object('error', 'Add your name.'); end if;
  insert into fk_seats (league, team, user_id, email, manager) values (p_id, p_team, uid, auth.jwt()->>'email', mg);
  update fk_leagues set draft = fk_stamp(p_id, draft), league = fk_stamp(p_id, league), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $function$;

-- a manager leaving hands the team to his co-manager; the commissioner freeing a team clears every seat on it
CREATE OR REPLACE FUNCTION public.fk_leave(p_id text, p_team integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare l fk_leagues; s fk_seats;
begin
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select * into s from fk_seats where league = p_id and team = p_team and not co;
  if not found then return jsonb_build_object('error', 'Nobody has that team.'); end if;
  if s.user_id <> auth.uid() and l.commish <> auth.uid() then return jsonb_build_object('error', 'Only that manager or the commissioner can do that.'); end if;
  if s.user_id = l.commish then return jsonb_build_object('error', 'The commissioner keeps a team.'); end if;
  if s.user_id = auth.uid() then delete from fk_seats where league = p_id and user_id = s.user_id;
  else delete from fk_seats where league = p_id and team = p_team; delete from fk_co_invites where league = p_id and team = p_team; end if;
  update fk_leagues set draft = fk_stamp(p_id, draft), league = fk_stamp(p_id, league), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $function$;

CREATE OR REPLACE FUNCTION public.fk_mine()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'sport', l.sport, 'team', s.team, 'co', coalesce(s.co, false), 'commish', l.commish = auth.uid(),
    'phase', case when l.league is not null then 'season' else coalesce(l.draft->>'phase', 'setup') end, 'updated', l.updated_at,
    'oneWeek', coalesce((l.draft->'season'->>'oneWeek')::boolean, false), 'series', l.series, 'seriesN', l.series_n,
    'slate', coalesce(l.draft->'season'->'slate'->>'label', l.draft->'season'->'showdown'->>'label'),
    'brand', l.league->'settings'->'brand',
    'card', fk_card(l, s.team)) order by l.updated_at desc), '[]'::jsonb)
  from fk_leagues l left join fk_seats s on s.league = l.id and s.user_id = auth.uid()
  where auth.uid() is not null and (s.user_id is not null or l.commish = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.fk_view(p_id text, p_since integer)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare l fk_leagues; uid uuid := auth.uid(); mine int; out jsonb;
begin
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select team into mine from fk_seats where league = p_id and user_id = uid;
  out := jsonb_build_object('version', l.version, 'now', (extract(epoch from now()) * 1000)::bigint, 'name', l.name, 'sport', l.sport,
    'me', mine, 'commish', uid is not null and uid = l.commish, 'seats', fk_seat_map(p_id),
    'notify', (select notify from fk_seats where league = p_id and user_id = uid),
    'co', coalesce((select co from fk_seats where league = p_id and user_id = uid), false));
  -- any manager in the league can share the invite link, and see the dues
  if uid is not null and (uid = l.commish or mine is not null) then out := out || jsonb_build_object('invite', l.invite, 'dues', l.dues); end if;
  if p_since is null or l.version > p_since then out := out || jsonb_build_object('draft', l.draft, 'league', l.league); end if;
  return out;
end $function$;

-- the claimed count on My leagues counts teams, not people
CREATE OR REPLACE FUNCTION public.fk_card(l fk_leagues, t integer)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with allg as (
    select k::int as wk, g
    from jsonb_each(case when jsonb_typeof(l.league->'results') = 'object' then l.league->'results' else '{}'::jsonb end) r(k, v),
      jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) g
    where k ~ '^\d+$' and jsonb_typeof(g) = 'object' and g ? 'a' and g ? 'b'
  ),
  games as (select wk, g from allg where t is not null and wk <= coalesce((l.league->'settings'->>'weeks')::int, 99)),
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
  mrec as (select count(*) filter (where sc > m) as w, count(*) filter (where sc < m) as lo, count(*) filter (where sc = m) as ti from med),
  -- each team's regular season: categories won, lost and tied in a category league, games otherwise
  sides as (
    select (g->>'a')::int as team, g ? 'cats' as c,
      case when g ? 'cats' then coalesce((g->>'sa')::numeric, 0) else (g->>'w' = 'a')::int end as w,
      case when g ? 'cats' then coalesce((g->>'sb')::numeric, 0) else (g->>'w' = 'b')::int end as lo,
      case when g ? 'cats' then coalesce((g->>'ties')::numeric, 0) else (g->>'w' = 't')::int end as ti
    from games
    union all
    select (g->>'b')::int, g ? 'cats',
      case when g ? 'cats' then coalesce((g->>'sb')::numeric, 0) else (g->>'w' = 'b')::int end,
      case when g ? 'cats' then coalesce((g->>'sa')::numeric, 0) else (g->>'w' = 'a')::int end,
      case when g ? 'cats' then coalesce((g->>'ties')::numeric, 0) else (g->>'w' = 't')::int end
    from games
  ),
  trec as (select team, bool_or(c) as c, sum(w) as w, sum(lo) as lo, sum(ti) as ti, (sum(w) + 0.5 * sum(ti)) / nullif(sum(w) + sum(lo) + sum(ti), 0) as pct from sides group by team),
  mine as (select * from trec where team = t),
  rk as (select case when (select pct from mine) is null then null else 1 + (select count(*) from trec o where o.pct > (select pct from mine)) end as rank),
  -- the finish: the last playoff week's placement game (title, third, p5, ...), won or lost
  lastg as (
    select g from allg
    where t is not null and wk = (select max(wk) from allg where wk > coalesce((l.league->'settings'->>'weeks')::int, 99))
      and ((g->>'a')::int = t or (g->>'b')::int = t) and g->>'kind' is not null
    limit 1
  ),
  fin as (
    select case
      when g->>'w' not in ('a', 'b') then null
      else (case g->>'kind' when 'title' then 1 when 'third' then 3 else nullif(substring(g->>'kind' from '^p(\d+)$'), '')::int end)
        + (case when ((g->>'a')::int = t and g->>'w' = 'a') or ((g->>'b')::int = t and g->>'w' = 'b') then 0 else 1 end)
    end as place from lastg
  )
  select jsonb_build_object(
    'teamName', case when t is null then null else coalesce(l.league, l.draft)->'teams'->t->>'name' end,
    'teams', jsonb_array_length(coalesce(coalesce(l.league, l.draft)->'teams', '[]'::jsonb)),
    'claimed', (select count(*) from fk_seats where league = l.id and not co),
    'week', (l.league->>'week')::int,
    'weeks', (l.league->'settings'->>'weeks')::int,
    'playoffWeeks', coalesce((l.league->'settings'->>'playoffWeeks')::int, 0),
    'format', l.league->'settings'->>'format',
    'start', (l.league->>'start')::bigint,
    'season', l.league->>'season',
    'alive', case when t is null or jsonb_typeof(l.league->'alive') <> 'array' then null else (l.league->'alive') @> to_jsonb(t) end,
    'picks', (select count(*) from jsonb_array_elements(case when jsonb_typeof(l.draft->'board') = 'array' then l.draft->'board' else '[]'::jsonb end) x where jsonb_typeof(x) = 'object'),
    'total', case when jsonb_typeof(l.draft->'order') = 'array' then jsonb_array_length(l.draft->'order') else null end,
    'w', r.w + m.w, 'l', r.lo + m.lo, 't', r.ti + m.ti,
    'cats', coalesce((select c from mine), false),
    'cw', (select w from mine), 'cl', (select lo from mine), 'ct', (select ti from mine),
    'rank', (select rank from rk),
    'place', (select place from fin))
  from rec r, mrec m;
$function$;

-- next week's game keeps the same managers, co-managers included
CREATE OR REPLACE FUNCTION public.fk_rematch(p_id text, p_draft jsonb, p_name text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
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
  insert into fk_seats (league, team, user_id, email, manager, notify, co)
    select new_id, team, user_id, email, manager, notify, co from fk_seats where league = p_id;
  update fk_leagues set draft = fk_stamp(new_id, draft), dues = case when l.dues is null then null else l.dues - 'paid' - 'claimed' end where id = new_id;
  select manager into who from fk_seats where league = p_id and user_id = uid;
  at := case when jsonb_typeof(p_draft->'startAt') = 'number'
    then to_char(to_timestamp((p_draft->>'startAt')::numeric / 1000) at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' ET' else null end;
  insert into fk_outbox (league, team, kind, subject, body, data)
    select distinct on (x.team) new_id, x.team, 'draft', fk_clean(nm || ': next week''s game is up', 120),
      coalesce(who, 'Someone') || ' ran it back: same group, game ' || n || coalesce(', ' || (p_draft->'season'->'slate'->>'label'), '') || '. '
        || case when at is not null then 'The draft starts on its own at ' || at || '.' else 'Jump in the draft room and set your queue.' end
        || E'\n\nOpen the game: https://davidsolar.dev/fantasy-kit/play.html?id=' || new_id, null
    from fk_seats x where x.league = new_id and x.notify and x.team <> coalesce((select team from fk_seats where league = new_id and user_id = uid), -1);
  return jsonb_build_object('ok', true, 'id', new_id, 'series_n', n);
end $function$;

/* ---------- co-manager invites, joining, the list and removing ---------- */
-- the team's manager makes (or remakes) the link's code; the commissioner can for any team
create or replace function public.fk_co_invite(p_id text, p_team int default null, p_new boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); l fk_leagues; t int; c text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if exists (select 1 from fk_pyramids where top = p_id or bot = p_id) then return jsonb_build_object('error', 'Co-managers aren''t available in a promotion and relegation pyramid.'); end if;
  select team into t from fk_seats where league = p_id and user_id = uid and not co;
  if p_team is not null and uid = l.commish then t := p_team; end if;
  if t is null then return jsonb_build_object('error', 'Only the team''s manager can invite a co-manager.'); end if;
  if not exists (select 1 from fk_seats where league = p_id and team = t and not co) then return jsonb_build_object('error', 'That team needs a manager first.'); end if;
  select code into c from fk_co_invites where league = p_id and team = t;
  if c is null or p_new then
    c := fk_rand(10);
    insert into fk_co_invites (league, team, code) values (p_id, t, c) on conflict (league, team) do update set code = excluded.code, created_at = now();
  end if;
  return jsonb_build_object('ok', true, 'team', t, 'code', c);
end $$;

-- who a co-manager link is for, before signing in to take it
create or replace function public.fk_co_peek(p_id text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l fk_leagues; i fk_co_invites;
begin
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select * into i from fk_co_invites where league = p_id and code = coalesce(p_code, '');
  if not found then return jsonb_build_object('error', 'That co-manager link has expired. Ask the team''s manager for a new one.'); end if;
  return jsonb_build_object('ok', true, 'name', l.name, 'sport', l.sport, 'team', i.team,
    'teamName', coalesce(l.league, l.draft)->'teams'->i.team->>'name',
    'manager', (select string_agg(manager, ' & ' order by co, joined_at) from fk_seats where league = p_id and team = i.team),
    'me', (select team from fk_seats where league = p_id and user_id = auth.uid()),
    'count', (select count(*) from fk_seats where league = p_id and team = i.team and co));
end $$;

create or replace function public.fk_co_join(p_id text, p_code text, p_manager text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l fk_leagues; i fk_co_invites; mg text := fk_clean(p_manager, 24); who text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select * into i from fk_co_invites where league = p_id and code = coalesce(p_code, '');
  if not found then return jsonb_build_object('error', 'That co-manager link has expired. Ask the team''s manager for a new one.'); end if;
  if exists (select 1 from fk_pyramids where top = p_id or bot = p_id) then return jsonb_build_object('error', 'Co-managers aren''t available in a promotion and relegation pyramid.'); end if;
  if exists (select 1 from fk_seats where league = p_id and user_id = uid) then return jsonb_build_object('error', 'You already have a team in this league.'); end if;
  if not exists (select 1 from fk_seats where league = p_id and team = i.team and not co) then return jsonb_build_object('error', 'That team doesn''t have a manager anymore. Ask the commissioner.'); end if;
  if (select count(*) from fk_seats where league = p_id and team = i.team and co) >= 2 then return jsonb_build_object('error', 'That team already has two co-managers.'); end if;
  if mg = '' then return jsonb_build_object('error', 'Add your name.'); end if;
  insert into fk_seats (league, team, user_id, email, manager, co) values (p_id, i.team, uid, auth.jwt()->>'email', mg, true);
  select manager into who from fk_seats where league = p_id and user_id = uid;
  insert into fk_outbox (league, team, kind, subject, body)
    select p_id, i.team, 'team', fk_clean(l.name || ': ' || who || ' is your co-manager', 120),
      who || ' joined ' || coalesce(coalesce(l.league, l.draft)->'teams'->i.team->>'name', 'your team') || ' as a co-manager. They can set the lineup, make trades and claim players, and they get the team''s alerts.'
        || E'\n\nOpen the league: https://davidsolar.dev/fantasy/league/?id=' || p_id
    where exists (select 1 from fk_seats where league = p_id and team = i.team and not co and notify);
  update fk_leagues set draft = fk_stamp(p_id, draft), league = fk_stamp(p_id, league), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'team', i.team, 'version', l.version + 1);
end $$;

-- the managers of your team (every team's, for the commissioner), for the league dialog
create or replace function public.fk_co_list(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); l fk_leagues; mine int;
begin
  select * into l from fk_leagues where id = p_id;
  if not found or uid is null then return jsonb_build_object('error', 'No league with that link.'); end if;
  select team into mine from fk_seats where league = p_id and user_id = uid;
  if mine is null and uid <> l.commish then return jsonb_build_object('error', 'You don''t have a team in this league.'); end if;
  return jsonb_build_object('ok', true, 'seats', coalesce((select jsonb_agg(jsonb_build_object('team', s.team, 'id', s.user_id, 'name', s.manager, 'co', s.co, 'me', s.user_id = uid) order by s.team, s.co, s.joined_at)
    from fk_seats s where s.league = p_id and (s.team = mine or (uid = l.commish and exists (select 1 from fk_seats o where o.league = p_id and o.team = s.team and o.co)))), '[]'::jsonb),
    'invite', (select code from fk_co_invites where league = p_id and team = mine and exists (select 1 from fk_seats where league = p_id and user_id = uid and not co)));
end $$;

-- a co-manager leaves; the team's manager or the commissioner removes one
create or replace function public.fk_co_remove(p_id text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l fk_leagues; s fk_seats;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select * into s from fk_seats where league = p_id and user_id = p_user and co;
  if not found then return jsonb_build_object('error', 'That co-manager isn''t on a team here.'); end if;
  if p_user <> uid and uid <> l.commish and not exists (select 1 from fk_seats where league = p_id and user_id = uid and team = s.team and not co) then
    return jsonb_build_object('error', 'Only the team''s manager or the commissioner can do that.');
  end if;
  delete from fk_seats where league = p_id and user_id = p_user;
  update fk_leagues set draft = fk_stamp(p_id, draft), league = fk_stamp(p_id, league), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $$;

revoke all on function public.fk_co_invite(text, int, boolean) from public, anon;
revoke all on function public.fk_co_join(text, text, text) from public, anon;
revoke all on function public.fk_co_list(text) from public, anon;
revoke all on function public.fk_co_remove(text, uuid) from public, anon;
revoke all on function public.fk_co_peek(text, text) from public;
grant execute on function public.fk_co_invite(text, int, boolean) to authenticated;
grant execute on function public.fk_co_join(text, text, text) to authenticated;
grant execute on function public.fk_co_list(text) to authenticated;
grant execute on function public.fk_co_remove(text, uuid) to authenticated;
grant execute on function public.fk_co_peek(text, text) to anon, authenticated;
revoke all on function public.fk_seat_promote() from public, anon, authenticated;

-- Sunday inactives: a fantasy data pull right after (the late-scratch alerts)
select cron.schedule('gh-fantasykit-data-7', '37 16 * * 0', $$select public.gh_dispatch('fantasykit-data.yml')$$);
