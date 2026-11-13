-- NFL pick'em against the spread (pickem/). One line per game, frozen at noon New York time the day before the week's
-- first game; picks lock at each game's kickoff; a win is a point, a push half. Everyone plays on one board, and private
-- groups (joined with a code) get their own. pk_sync, on pg_cron every 10 minutes, reads ESPN's scoreboard through
-- pg_net: each run saves the scoreboards the last run asked for, freezes lines that are due, and asks again.
-- Run in the Supabase SQL editor (it's safe to run again).

create table if not exists public.pk_games (
  game_id text primary key,
  season int not null, stype int not null default 2, week int not null,
  kickoff timestamptz not null, away text not null, home text not null,
  live_spread numeric,            -- the home team's spread right now (ESPN), kept as it was at kickoff
  spread numeric,                 -- the home team's spread, frozen: the line every pick is graded against
  frozen_at timestamptz,
  status text, away_score int, home_score int, final boolean not null default false,
  updated_at timestamptz not null default now());
create index if not exists pk_games_week on public.pk_games (season, stype, week);
create table if not exists public.pk_picks (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id text not null references public.pk_games (game_id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  picked_at timestamptz not null default now(),
  primary key (user_id, game_id));
create index if not exists pk_picks_game on public.pk_picks (game_id);
create table if not exists public.pk_groups (
  id text primary key, name text not null, owner uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now());
create table if not exists public.pk_members (
  group_id text not null references public.pk_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id));
create index if not exists pk_members_user on public.pk_members (user_id);
create table if not exists public.pk_sync_req (id bigint primary key, at timestamptz not null default now());
-- no policies: everything goes through the functions below
alter table public.pk_games enable row level security;
alter table public.pk_picks enable row level security;
alter table public.pk_groups enable row level security;
alter table public.pk_members enable row level security;
alter table public.pk_sync_req enable row level security;

-- when a week's lines freeze: noon in New York the day before its first game
create or replace function public.pk_freeze_at(p_season int, p_stype int, p_week int) returns timestamptz
language sql stable security definer set search_path to 'public' as $$
  select (((min(kickoff) at time zone 'America/New_York')::date - 1) + time '12:00') at time zone 'America/New_York'
  from pk_games where season = p_season and stype = p_stype and week = p_week;
$$;

-- a pick's result: 1 a win, 0.5 a push, 0 a loss, null not graded yet
create or replace function public.pk_result(g pk_games, side text) returns numeric
language sql immutable as $$
  select case when not g.final or g.spread is null then null
    when g.home_score + g.spread = g.away_score then 0.5
    when (g.home_score + g.spread > g.away_score) = (side = 'home') then 1 else 0 end;
$$;

-- the name someone shows as: their profile name, else their username, else "Player"
create or replace function public.pk_name(u uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(trim((select name from fk_profiles where user_id = u)), ''), (select username from fk_usernames where user_id = u), 'Player');
$$;

-- the sync: save the scoreboards asked for last time, freeze what's due, then ask again (this week's, and last week's
-- for late finishes)
create or replace function public.pk_sync() returns jsonb
language plpgsql security definer set search_path to 'public', 'net' as $$
declare r record; ev jsonb; c jsonb; h jsonb; a jsonb; n int := 0; wk int; yr int; st int;
begin
  for r in select q.id, x.content from pk_sync_req q join net._http_response x on x.id = q.id where x.status_code = 200 loop
    begin
      wk := (r.content::jsonb -> 'week' ->> 'number')::int; yr := (r.content::jsonb -> 'season' ->> 'year')::int; st := (r.content::jsonb -> 'season' ->> 'type')::int;
      for ev in select * from jsonb_array_elements(r.content::jsonb -> 'events') loop
        c := ev -> 'competitions' -> 0;
        select x into h from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'home';
        select x into a from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'away';
        insert into pk_games (game_id, season, stype, week, kickoff, away, home, live_spread, status, away_score, home_score, final, updated_at)
        values (ev ->> 'id', coalesce((ev -> 'season' ->> 'year')::int, yr), coalesce((ev -> 'season' ->> 'type')::int, st), coalesce((ev -> 'week' ->> 'number')::int, wk),
          (ev ->> 'date')::timestamptz, a -> 'team' ->> 'abbreviation', h -> 'team' ->> 'abbreviation', (c -> 'odds' -> 0 ->> 'spread')::numeric,
          ev -> 'status' -> 'type' ->> 'name', nullif(a ->> 'score', '')::int, nullif(h ->> 'score', '')::int,
          coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false), now())
        on conflict (game_id) do update set kickoff = excluded.kickoff, away = excluded.away, home = excluded.home, status = excluded.status,
          away_score = excluded.away_score, home_score = excluded.home_score, final = excluded.final, updated_at = now(),
          -- the line moves until kickoff; after that ESPN drops it, so keep the last one
          live_spread = case when excluded.kickoff > now() then coalesce(excluded.live_spread, pk_games.live_spread) else pk_games.live_spread end;
        n := n + 1;
      end loop;
    exception when others then null;
    end;
  end loop;
  delete from pk_sync_req where id in (select q.id from pk_sync_req q left join net._http_response x on x.id = q.id where x.id is not null or q.at < now() - interval '1 hour');
  -- freeze: every game whose week's freeze time has passed, that has a line and hasn't started
  update pk_games g set spread = g.live_spread, frozen_at = now()
  where g.spread is null and g.live_spread is not null and g.kickoff > now() and now() >= pk_freeze_at(g.season, g.stype, g.week);
  -- ask ESPN again: the current week, and the week before it
  insert into pk_sync_req (id) select net.http_get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', timeout_milliseconds => 20000);
  select season, stype, week into yr, st, wk from pk_games where kickoff < now() + interval '6 days' order by kickoff desc limit 1;
  if wk is not null and wk > 1 then
    insert into pk_sync_req (id) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=%s&week=%s&dates=%s', st, wk - 1, yr), timeout_milliseconds => 20000);
  end if;
  return jsonb_build_object('saved', n);
end $$;

-- the week's board: its games, the frozen lines, and your picks. Anyone can look; picks need an account.
create or replace function public.pk_board(p_season int default null, p_stype int default null, p_week int default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); s int := p_season; t int := p_stype; w int := p_week; fz timestamptz;
begin
  if w is null then
    -- this week: the week of the next game not finished, else the last week played
    select season, stype, week into s, t, w from pk_games where not final order by kickoff limit 1;
    if w is null then select season, stype, week into s, t, w from pk_games order by kickoff desc limit 1; end if;
  end if;
  if w is null then return jsonb_build_object('ok', true, 'games', '[]'::jsonb, 'signedIn', uid is not null); end if;
  t := coalesce(t, 2);
  if s is null then select season into s from pk_games where week = w and stype = t order by kickoff desc limit 1; end if;
  fz := pk_freeze_at(s, t, w);
  return jsonb_build_object('ok', true, 'season', s, 'stype', t, 'week', w, 'freezeAt', fz, 'now', now(), 'signedIn', uid is not null,
    'weeks', (select jsonb_agg(x order by (x ->> 'stype')::int, (x ->> 'week')::int) from (select distinct jsonb_build_object('stype', stype, 'week', week) x from pk_games where season = s) q),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'kickoff', g.kickoff, 'away', g.away, 'home', g.home,
        'spread', g.spread, 'line', case when g.spread is null and g.kickoff > now() then g.live_spread end, 'status', g.status,
        'awayScore', g.away_score, 'homeScore', g.home_score, 'final', g.final, 'locked', g.kickoff <= now(),
        'pick', p.side, 'result', case when p.side is not null then pk_result(g, p.side) end,
        'cover', case when g.final and g.spread is not null then case when g.home_score + g.spread > g.away_score then 'home' when g.home_score + g.spread < g.away_score then 'away' else 'push' end end,
        'split', case when g.kickoff <= now() then (select jsonb_build_object('home', count(*) filter (where side = 'home'), 'away', count(*) filter (where side = 'away')) from pk_picks where game_id = g.game_id) end)
      order by g.kickoff, g.game_id) from pk_games g left join pk_picks p on p.game_id = g.game_id and p.user_id = uid
      where g.season = s and g.stype = t and g.week = w), '[]'::jsonb),
    'me', case when uid is not null then (select jsonb_build_object('w', count(*) filter (where pk_result(g, p.side) = 1), 'l', count(*) filter (where pk_result(g, p.side) = 0), 'p', count(*) filter (where pk_result(g, p.side) = 0.5))
      from pk_picks p join pk_games g on g.game_id = p.game_id where p.user_id = uid and g.season = s) end);
end $$;

-- make or change a pick (side null takes it back), until the game kicks off
create or replace function public.pk_pick(p_game text, p_side text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); g pk_games;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make picks.'); end if;
  select * into g from pk_games where game_id = p_game;
  if not found then return jsonb_build_object('error', 'That game isn''t on the board.'); end if;
  if g.kickoff <= now() then return jsonb_build_object('error', 'That game has kicked off. Its pick is locked.'); end if;
  if g.spread is null then return jsonb_build_object('error', 'This week''s lines aren''t set yet.'); end if;
  if p_side is null then delete from pk_picks where user_id = uid and game_id = p_game; return jsonb_build_object('ok', true, 'pick', null); end if;
  if p_side not in ('home', 'away') then return jsonb_build_object('error', 'Pick a side.'); end if;
  insert into pk_picks (user_id, game_id, side) values (uid, p_game, p_side)
  on conflict (user_id, game_id) do update set side = excluded.side, picked_at = now();
  return jsonb_build_object('ok', true, 'pick', p_side);
end $$;

-- standings for the season: everyone, or one of your groups; with a week, that week's results too
create or replace function public.pk_standings(p_group text default null, p_season int default null, p_stype int default null, p_week int default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); s int := p_season; gname text;
begin
  if p_group is not null then
    if uid is null or not exists (select 1 from pk_members where group_id = p_group and user_id = uid) then return jsonb_build_object('error', 'Join this group to see its standings.'); end if;
    select name into gname from pk_groups where id = p_group;
  end if;
  if s is null then select season into s from pk_games order by kickoff desc limit 1; end if;
  return jsonb_build_object('ok', true, 'season', s, 'group', gname, 'rows', coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.pts desc, x.l, x.name) from (
    select p.user_id = uid as me, pk_name(p.user_id) as name,
      count(*) filter (where pk_result(g, p.side) = 1) as w, count(*) filter (where pk_result(g, p.side) = 0) as l, count(*) filter (where pk_result(g, p.side) = 0.5) as p,
      coalesce(sum(pk_result(g, p.side)), 0) as pts,
      count(*) filter (where p_week is not null and g.week = p_week and g.stype = coalesce(p_stype, 2) and pk_result(g, p.side) = 1) as ww,
      count(*) filter (where p_week is not null and g.week = p_week and g.stype = coalesce(p_stype, 2) and pk_result(g, p.side) = 0) as wl,
      count(*) filter (where p_week is not null and g.week = p_week and g.stype = coalesce(p_stype, 2) and pk_result(g, p.side) = 0.5) as wp
    from pk_picks p join pk_games g on g.game_id = p.game_id
    where g.season = s and (p_group is null or p.user_id in (select user_id from pk_members where group_id = p_group))
    group by p.user_id
    having count(*) filter (where g.final) > 0 or p.user_id = uid or p_group is not null
    order by 6 desc limit 300) x), '[]'::jsonb));
end $$;

-- a group's picks for a week: everyone's, game by game, once each game has kicked off (your own any time)
create or replace function public.pk_group_week(p_group text, p_season int, p_stype int, p_week int) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from pk_members where group_id = p_group and user_id = uid) then return jsonb_build_object('error', 'Join this group to see its picks.'); end if;
  return jsonb_build_object('ok', true,
    'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', pk_name(m.user_id), 'me', m.user_id = uid) order by m.joined_at) from pk_members m where m.group_id = p_group),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('game', p.game_id, 'user', p.user_id, 'side', case when g.kickoff <= now() or p.user_id = uid then p.side end, 'result', pk_result(g, p.side)))
      from pk_picks p join pk_games g on g.game_id = p.game_id
      where g.season = p_season and g.stype = p_stype and g.week = p_week and p.user_id in (select user_id from pk_members where group_id = p_group)), '[]'::jsonb));
end $$;

-- groups: make one (a six-letter code to share), join with a code, leave, look one up, and the ones you're in
create or replace function public.pk_group_create(p_name text) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40);
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a group.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the group.'); end if;
  if (select count(*) from pk_groups where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of groups. Leave one first.'); end if;
  loop
    -- no 0/O or 1/I/L, so a code read aloud is a code typed right
    code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=0Oo1IiLl', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from pk_groups where id = code);
  end loop;
  insert into pk_groups (id, name, owner) values (code, nm, uid);
  insert into pk_members (group_id, user_id) values (code, uid);
  return jsonb_build_object('ok', true, 'id', code, 'name', nm);
end $$;
create or replace function public.pk_group_join(p_code text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); g pk_groups;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to join a group.'); end if;
  select * into g from pk_groups where id = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('error', 'No group has that code. Check it and try again.'); end if;
  if (select count(*) from pk_members where group_id = g.id) >= 200 then return jsonb_build_object('error', 'That group is full.'); end if;
  insert into pk_members (group_id, user_id) values (g.id, uid) on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', g.id, 'name', g.name);
end $$;
create or replace function public.pk_group_leave(p_code text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  delete from pk_members where group_id = p_code and user_id = uid;
  -- the last one out turns off the lights
  delete from pk_groups where id = p_code and not exists (select 1 from pk_members where group_id = p_code);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.pk_group_peek(p_code text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select jsonb_build_object('ok', true, 'id', g.id, 'name', g.name, 'members', (select count(*) from pk_members where group_id = g.id)) from pk_groups g where g.id = upper(trim(coalesce(p_code, '')))), jsonb_build_object('error', 'No group has that code.'));
$$;
create or replace function public.pk_groups_mine() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'owner', g.owner = auth.uid(), 'members', (select count(*) from pk_members where group_id = g.id)) order by m.joined_at), '[]'::jsonb)
  from pk_members m join pk_groups g on g.id = m.group_id where m.user_id = auth.uid();
$$;

revoke all on function public.pk_sync(), public.pk_freeze_at(int, int, int), public.pk_name(uuid) from public, anon, authenticated;
revoke all on function public.pk_board(int, int, int), public.pk_pick(text, text), public.pk_standings(text, int, int, int), public.pk_group_week(text, int, int, int),
  public.pk_group_create(text), public.pk_group_join(text), public.pk_group_leave(text), public.pk_group_peek(text), public.pk_groups_mine() from public;
grant execute on function public.pk_board(int, int, int), public.pk_standings(text, int, int, int), public.pk_group_peek(text) to anon, authenticated;
grant execute on function public.pk_pick(text, text), public.pk_group_week(text, int, int, int), public.pk_group_create(text), public.pk_group_join(text),
  public.pk_group_leave(text), public.pk_groups_mine() to authenticated;

-- every 10 minutes (the first run only asks; the second saves)
select cron.unschedule('pickem-sync') where exists (select 1 from cron.job where jobname = 'pickem-sync');
select cron.schedule('pickem-sync', '*/10 * * * *', $job$ select public.pk_sync(); $job$);
