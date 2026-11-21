-- Draft Lab's pools (fantasy/pools/): March Madness survivor and the 5-team game, and season-long NFL survivor (below). Built like the NFL pick'em
-- (tools/pickem_supabase.sql): the games live here, picks lock here at tip-off, and mm_sync on pg_cron every 10 minutes
-- reads the outside world through pg_net (each run saves what the last run asked for, then asks again).
--
--   Survivor: one team a day, every day of the tournament from the first round on (no First Four), never the same team
--   twice, no 1 or 2 seed on day 1. A loss, or no pick by the time that day's last game tips, is out. When everyone
--   still alive loses on the same day, they split the win; the last one standing wins; whoever survives the title game
--   splits it.
--   5 teams: five teams whose seeds add up to 25 or more, locked at the first round's first tip. Every win scores
--   1, 2, 4, 8, 16, 32 points by round (First Four wins don't count). Most points wins.
--
-- Before the field is out, the games are the college hub's projected bracket (cbb/data/extras.json): the first round
-- and the First Four on this season's real dates, so a pool can be set up and practiced. The first real tournament
-- game from ESPN replaces the projection and clears practice picks.
-- Run in the Supabase SQL editor (it's safe to run again).

create table if not exists public.mm_games (
  game_id text primary key,
  season int not null, round int not null,          -- 0 First Four, 1 first round ... 6 title game
  region text, day date not null, tip timestamptz not null,
  a text, b text, a_seed int, b_seed int, a_score int, b_score int, winner text,
  status text, final boolean not null default false, projected boolean not null default false,
  updated_at timestamptz not null default now());
create index if not exists mm_games_season on public.mm_games (season, round, day);
create table if not exists public.mm_pools (
  id text primary key, name text not null, kind text not null check (kind in ('survivor', 'five')), season int not null,
  owner uuid references auth.users (id) on delete set null, created_at timestamptz not null default now());
create table if not exists public.mm_members (
  pool text not null references public.mm_pools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text, joined_at timestamptz not null default now(),
  primary key (pool, user_id));
create index if not exists mm_members_user on public.mm_members (user_id);
create table if not exists public.mm_picks (
  pool text not null, user_id uuid not null, slot text not null, team text not null, picked_at timestamptz not null default now(),
  primary key (pool, user_id, slot),
  foreign key (pool, user_id) references public.mm_members (pool, user_id) on delete cascade);
create table if not exists public.mm_sync_req (id bigint primary key, kind text not null, at timestamptz not null default now());
create table if not exists public.mm_meta (k text primary key, v text, at timestamptz not null default now());
alter table public.mm_games enable row level security;
alter table public.mm_pools enable row level security;
alter table public.mm_members enable row level security;
alter table public.mm_picks enable row level security;
alter table public.mm_sync_req enable row level security;
alter table public.mm_meta enable row level security;

-- the tournament a season names: the one in March of the coming year from July on
create or replace function public.mm_season() returns int
language sql stable as $$
  select case when extract(month from (now() at time zone 'America/New_York')) >= 7 then extract(year from now())::int + 1 else extract(year from now())::int end;
$$;
-- survivor's day n: the nth date with a game from the first round on
create or replace function public.mm_day_date(p_season int, p_day int) returns date
language sql stable security definer set search_path to 'public' as $$
  select d from (select distinct day d from mm_games where season = p_season and round >= 1) x order by d offset greatest(p_day, 1) - 1 limit 1;
$$;
-- the 5-team game locks at the first round's first tip
create or replace function public.mm_five_lock(p_season int) returns timestamptz
language sql stable security definer set search_path to 'public' as $$
  select min(tip) from mm_games where season = p_season and round = 1;
$$;
create or replace function public.mm_seed(p_season int, p_team text) returns int
language sql stable security definer set search_path to 'public' as $$
  select max(case when a = p_team then a_seed when b = p_team then b_seed end) from mm_games where season = p_season and p_team in (a, b);
$$;
create or replace function public.mm_name(p_pool text, u uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(trim((select name from mm_members where pool = p_pool and user_id = u)), ''), pk_name(u));
$$;

-- the projected bracket: four regions of sixteen seed lines from the hub's sim (extras.json season.bracket), a line
-- with two teams being a First Four game whose first team is the projected winner. Real dates: Selection Sunday, the
-- First Four Tuesday and Wednesday (from 4 PM, every 75 minutes), the first round Thursday (first two regions) and
-- Friday, tips every half hour from 12:15 PM Eastern.
create or replace function public.mm_project(j jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare ss date; s int; i int; k int; reg jsonb; lo jsonb; hi jsonb; names text[] := array['East', 'West', 'South', 'Midwest']; n int := 0; d date; t text;
begin
  ss := (j -> 'season' ->> 'selectionSunday')::date;
  if ss is null or jsonb_typeof(j -> 'season' -> 'bracket') <> 'array' then return 0; end if;
  s := extract(year from ss)::int;
  if exists (select 1 from mm_games where season = s and not projected) then return 0; end if;
  delete from mm_games where season = s and projected;
  for i in 0 .. least(3, jsonb_array_length(j -> 'season' -> 'bracket') - 1) loop
    reg := j -> 'season' -> 'bracket' -> i;
    for k in 0 .. 7 loop
      lo := reg -> (2 * k); hi := reg -> (2 * k + 1);
      if lo is null or hi is null then continue; end if;
      foreach t in array array['lo', 'hi'] loop
        if jsonb_array_length((case when t = 'lo' then lo else hi end) -> 'teams') > 1 then
          d := ss + case when i < 2 then 2 else 3 end;
          insert into mm_games (game_id, season, round, region, day, tip, a, b, a_seed, b_seed, status, projected)
          values (format('proj-%s-0-%s-%s-%s', s, i, k, t), s, 0, names[i + 1], d,
            ((d + time '16:00') + make_interval(mins => 75 * (select count(*) from mm_games where season = s and round = 0 and day = d)::int)) at time zone 'America/New_York',
            (case when t = 'lo' then lo else hi end) -> 'teams' ->> 0, (case when t = 'lo' then lo else hi end) -> 'teams' ->> 1,
            ((case when t = 'lo' then lo else hi end) ->> 'seed')::int, ((case when t = 'lo' then lo else hi end) ->> 'seed')::int, 'STATUS_SCHEDULED', true);
          n := n + 1;
        end if;
      end loop;
      d := ss + case when i < 2 then 4 else 5 end;
      insert into mm_games (game_id, season, round, region, day, tip, a, b, a_seed, b_seed, status, projected)
      values (format('proj-%s-1-%s-%s', s, i, k), s, 1, names[i + 1], d,
        ((d + time '12:15') + make_interval(mins => 30 * ((i % 2) * 8 + k))) at time zone 'America/New_York',
        lo -> 'teams' ->> 0, hi -> 'teams' ->> 0, (lo ->> 'seed')::int, (hi ->> 'seed')::int, 'STATUS_SCHEDULED', true);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- one ESPN scoreboard: the tournament's games, by round from the game's note ("Men's Basketball Championship - East
-- Region - 1st Round"), seeds from the scoreboard (its rank spot carries the seed in March)
create or replace function public.mm_espn(j jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare ev jsonb; c jsonb; x jsonb; y jsonb; hl text; rd int; s int; n int := 0;
begin
  for ev in select * from jsonb_array_elements(coalesce(j -> 'events', '[]'::jsonb)) loop
    c := ev -> 'competitions' -> 0;
    hl := coalesce(c -> 'notes' -> 0 ->> 'headline', '');
    if hl !~* 'men''s basketball championship' then continue; end if;
    rd := case when hl ~* 'first four' then 0 when hl ~* '1st round|first round' then 1 when hl ~* '2nd round|second round' then 2
      when hl ~* 'sweet 16|sweet sixteen' then 3 when hl ~* 'elite 8|elite eight' then 4 when hl ~* 'final four' then 5
      when hl ~* 'national championship' then 6 end;
    if rd is null then continue; end if;
    s := coalesce((ev -> 'season' ->> 'year')::int, extract(year from (ev ->> 'date')::timestamptz)::int);
    -- the field is out: the projection and its practice picks go
    if exists (select 1 from mm_games where season = s and projected) then
      delete from mm_games where season = s and projected;
      delete from mm_picks where pool in (select id from mm_pools where season = s);
    end if;
    x := c -> 'competitors' -> 0; y := c -> 'competitors' -> 1;
    insert into mm_games (game_id, season, round, region, day, tip, a, b, a_seed, b_seed, a_score, b_score, winner, status, final, projected, updated_at)
    values (ev ->> 'id', s, rd, substring(hl from '- *([A-Za-z]+) Region'), ((ev ->> 'date')::timestamptz at time zone 'America/New_York')::date, (ev ->> 'date')::timestamptz,
      x -> 'team' ->> 'id', y -> 'team' ->> 'id',
      (select v from (select coalesce(nullif(x ->> 'seed', '')::int, nullif(x -> 'curatedRank' ->> 'current', '')::int) v) q where v between 1 and 16),
      (select v from (select coalesce(nullif(y ->> 'seed', '')::int, nullif(y -> 'curatedRank' ->> 'current', '')::int) v) q where v between 1 and 16),
      nullif(x ->> 'score', '')::int, nullif(y ->> 'score', '')::int,
      case when (x ->> 'winner')::boolean then x -> 'team' ->> 'id' when (y ->> 'winner')::boolean then y -> 'team' ->> 'id' end,
      ev -> 'status' -> 'type' ->> 'name', coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false), false, now())
    on conflict (game_id) do update set round = excluded.round, region = coalesce(excluded.region, mm_games.region), day = excluded.day, tip = excluded.tip,
      a = excluded.a, b = excluded.b, a_seed = coalesce(excluded.a_seed, mm_games.a_seed), b_seed = coalesce(excluded.b_seed, mm_games.b_seed),
      a_score = excluded.a_score, b_score = excluded.b_score, winner = excluded.winner, status = excluded.status, final = excluded.final, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- the sync: save what the last run asked for, then ask again: the projected bracket every six hours until the field
-- is out, and ESPN's tournament scoreboards from Selection Sunday through the title game (yesterday through four days out)
create or replace function public.mm_sync() returns jsonb
language plpgsql security definer set search_path to 'public', 'net' as $$
declare r record; n int := 0; s int := mm_season(); ss date; d date; real_on boolean;
begin
  for r in select q.id, q.kind, x.content from mm_sync_req q join net._http_response x on x.id = q.id where x.status_code = 200 loop
    begin
      if r.kind = 'proj' then
        n := n + mm_project(r.content::jsonb);
        insert into mm_meta (k, v, at) values ('selection_sunday', r.content::jsonb -> 'season' ->> 'selectionSunday', now())
        on conflict (k) do update set v = excluded.v, at = now();
      else n := n + mm_espn(r.content::jsonb); end if;
    exception when others then null;
    end;
  end loop;
  delete from mm_sync_req where id in (select q.id from mm_sync_req q left join net._http_response x on x.id = q.id where x.id is not null or q.at < now() - interval '1 hour');
  real_on := exists (select 1 from mm_games where season = s and not projected);
  if not real_on and coalesce((select at from mm_meta where k = 'proj_asked'), '-infinity') < now() - interval '6 hours' then
    insert into mm_sync_req (id, kind) select net.http_get('https://davidsolar.dev/cbb/data/extras.json', timeout_milliseconds => 20000), 'proj';
    insert into mm_meta (k, v, at) values ('proj_asked', null, now()) on conflict (k) do update set at = now();
  end if;
  ss := coalesce((select v::date from mm_meta where k = 'selection_sunday'), make_date(s, 3, 15));
  for d in select generate_series(greatest(ss, (now() at time zone 'America/New_York')::date - 1), least(ss + 23, (now() at time zone 'America/New_York')::date + 4), interval '1 day')::date loop
    insert into mm_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=%s&groups=50&limit=400', to_char(d, 'YYYYMMDD')), timeout_milliseconds => 20000), 'espn';
  end loop;
  return jsonb_build_object('saved', n);
end $$;

-- a pool's board: its games, its entries, and the picks you're allowed to see (yours any time; everyone else's once
-- the pick has locked)
create or replace function public.mm_board(p_pool text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; lk timestamptz;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found then return jsonb_build_object('error', 'No pool has that code.'); end if;
  if uid is null or not exists (select 1 from mm_members where pool = p.id and user_id = uid) then
    return jsonb_build_object('error', 'join', 'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season,
      'members', (select count(*) from mm_members where pool = p.id)), 'signedIn', uid is not null);
  end if;
  lk := mm_five_lock(p.season);
  return jsonb_build_object('ok', true, 'now', now(), 'fiveLock', lk,
    'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = uid),
    'projected', exists (select 1 from mm_games where season = p.season and projected) and not exists (select 1 from mm_games where season = p.season and not projected),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'round', g.round, 'region', g.region, 'day', g.day, 'tip', g.tip,
        'a', g.a, 'b', g.b, 'as', g.a_seed, 'bs', g.b_seed, 'ap', g.a_score, 'bp', g.b_score, 'w', g.winner, 'status', g.status, 'final', g.final)
      order by g.tip, g.game_id) from mm_games g where g.season = p.season), '[]'::jsonb),
    'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('user', k.user_id, 'slot', k.slot,
        'team', case when k.user_id = uid then k.team
          when p.kind = 'five' and lk is not null and now() >= lk then k.team
          when p.kind = 'survivor' and exists (select 1 from mm_games g where g.season = p.season and g.round >= 1 and k.team in (g.a, g.b)
            and g.day = mm_day_date(p.season, substring(k.slot from 2)::int) and g.tip <= now()) then k.team end))
      from mm_picks k where k.pool = p.id), '[]'::jsonb));
end $$;

-- survivor: pick (or change, or with a null team take back) the day's team until its game tips
create or replace function public.mm_pick(p_pool text, p_day int, p_team text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; dd date; g mm_games; cur text; sd int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make picks.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'survivor' then return jsonb_build_object('error', 'That isn''t a survivor pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to pick.'); end if;
  dd := mm_day_date(p.season, p_day);
  if dd is null then return jsonb_build_object('error', 'That day''s games aren''t set yet.'); end if;
  select team into cur from mm_picks where pool = p.id and user_id = uid and slot = 'd' || p_day;
  if cur is not null and exists (select 1 from mm_games where season = p.season and round >= 1 and day = dd and cur in (a, b) and tip <= now()) then
    return jsonb_build_object('error', 'Your pick for that day has tipped off. It''s locked.');
  end if;
  if p_team is null then delete from mm_picks where pool = p.id and user_id = uid and slot = 'd' || p_day; return jsonb_build_object('ok', true, 'team', null); end if;
  select * into g from mm_games where season = p.season and round >= 1 and day = dd and p_team in (a, b) order by tip limit 1;
  if not found then return jsonb_build_object('error', 'That team doesn''t play that day.'); end if;
  if g.tip <= now() then return jsonb_build_object('error', 'That game has tipped off.'); end if;
  if g.winner is not null then return jsonb_build_object('error', 'That game is over.'); end if;
  sd := case when g.a = p_team then g.a_seed else g.b_seed end;
  if p_day = 1 and sd is not null and sd <= 2 then return jsonb_build_object('error', 'No 1 or 2 seeds on day 1.'); end if;
  if exists (select 1 from mm_picks where pool = p.id and user_id = uid and team = p_team and slot <> 'd' || p_day) then
    return jsonb_build_object('error', 'You''ve already used that team.');
  end if;
  insert into mm_picks (pool, user_id, slot, team) values (p.id, uid, 'd' || p_day, p_team)
  on conflict (pool, user_id, slot) do update set team = excluded.team, picked_at = now();
  return jsonb_build_object('ok', true, 'team', p_team);
end $$;

-- the 5-team game: all five at once, seeds adding up to 25 or more, until the first round tips
create or replace function public.mm_pick_five(p_pool text, p_teams text[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; lk timestamptz; t text; tot int := 0; sd int; i int := 0;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make picks.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'five' then return jsonb_build_object('error', 'That isn''t a 5-team pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to pick.'); end if;
  lk := mm_five_lock(p.season);
  if lk is null then return jsonb_build_object('error', 'The bracket isn''t set yet.'); end if;
  if now() >= lk then return jsonb_build_object('error', 'The first round has tipped off. Picks are locked.'); end if;
  if coalesce(array_length(p_teams, 1), 0) <> 5 or (select count(distinct x) from unnest(p_teams) x) <> 5 then return jsonb_build_object('error', 'Pick five different teams.'); end if;
  foreach t in array p_teams loop
    sd := mm_seed(p.season, t);
    if sd is null then return jsonb_build_object('error', 'One of those teams isn''t in the field.'); end if;
    tot := tot + sd;
  end loop;
  if tot < 25 then return jsonb_build_object('error', format('Your seeds add up to %s. They need to reach 25.', tot)); end if;
  delete from mm_picks where pool = p.id and user_id = uid;
  foreach t in array p_teams loop i := i + 1; insert into mm_picks (pool, user_id, slot, team) values (p.id, uid, 'f' || i, t); end loop;
  return jsonb_build_object('ok', true, 'seeds', tot);
end $$;

-- pools: make one (a six-letter code to share), join with a code, leave, look one up, and yours
create or replace function public.mm_pool_create(p_name text, p_kind text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40);
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a pool.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  if p_kind not in ('survivor', 'five') then return jsonb_build_object('error', 'Pick a game.'); end if;
  if (select count(*) from mm_pools where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of pools. Leave one first.'); end if;
  loop
    code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=0Oo1IiLl', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from mm_pools where id = code);
  end loop;
  insert into mm_pools (id, name, kind, season, owner) values (code, nm, p_kind, mm_season(), uid);
  insert into mm_members (pool, user_id, name) values (code, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''));
  return jsonb_build_object('ok', true, 'id', code, 'name', nm, 'kind', p_kind);
end $$;
create or replace function public.mm_pool_join(p_code text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to join a pool.'); end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('error', 'No pool has that code. Check it and try again.'); end if;
  if (select count(*) from mm_members where pool = p.id) >= 200 then return jsonb_build_object('error', 'That pool is full.'); end if;
  insert into mm_members (pool, user_id, name) values (p.id, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''))
  on conflict (pool, user_id) do update set name = coalesce(excluded.name, mm_members.name);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'kind', p.kind);
end $$;
create or replace function public.mm_pool_leave(p_code text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  delete from mm_members where pool = p_code and user_id = uid;
  delete from mm_pools where id = p_code and not exists (select 1 from mm_members where pool = p_code);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.mm_pools_mine() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = auth.uid(),
    'members', (select count(*) from mm_members where pool = p.id)) order by m.joined_at desc), '[]'::jsonb)
  from mm_members m join mm_pools p on p.id = m.pool where m.user_id = auth.uid();
$$;

revoke all on function public.mm_sync(), public.mm_project(jsonb), public.mm_espn(jsonb), public.mm_season(), public.mm_day_date(int, int),
  public.mm_five_lock(int), public.mm_seed(int, text), public.mm_name(text, uuid) from public, anon, authenticated;
revoke all on function public.mm_board(text), public.mm_pick(text, int, text), public.mm_pick_five(text, text[]), public.mm_pool_create(text, text, text),
  public.mm_pool_join(text, text), public.mm_pool_leave(text), public.mm_pools_mine() from public;
grant execute on function public.mm_board(text) to anon, authenticated;
grant execute on function public.mm_pick(text, int, text), public.mm_pick_five(text, text[]), public.mm_pool_create(text, text, text),
  public.mm_pool_join(text, text), public.mm_pool_leave(text), public.mm_pools_mine() to authenticated;

-- NFL survivor, season long (kind 'nfl'), on the pick'em's games (pk_games, kept current by pk_sync).
--   One team a week to win outright, from the pool's first week (the week it was made in, if games were still to play)
--   through week 18. Never the same team twice. A loss or a tie, or no pick by the week's last kickoff, is out. Each
--   pick locks at its own game's kickoff and shows to everyone then. The last one standing wins; if everyone left goes
--   out the same week, or more than one makes it through week 18, they split it.
alter table public.mm_pools add column if not exists start_week int;
alter table public.mm_pools drop constraint if exists mm_pools_kind_check;
alter table public.mm_pools add constraint mm_pools_kind_check check (kind in ('survivor', 'five', 'nfl'));

-- the NFL season pk_games is on, and the first regular-season week with a game still to kick off
create or replace function public.mm_nfl_season() returns int
language sql stable security definer set search_path to 'public' as $$
  select season from pk_games order by kickoff desc limit 1;
$$;
create or replace function public.mm_nfl_start(p_season int) returns int
language sql stable security definer set search_path to 'public' as $$
  select week from pk_games where season = p_season and stype = 2 and kickoff > now() order by kickoff limit 1;
$$;
-- still alive going into week p_week: every earlier week from the start has a winning pick (a missed week counts once
-- its last game has kicked off; a pick still playing doesn't count against you yet)
create or replace function public.mm_nfl_alive(p_pool text, u uuid, p_week int) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select not exists (
    select 1 from mm_pools p, generate_series(p.start_week, p_week - 1) w
    where p.id = p_pool and (
      exists (select 1 from mm_picks k join pk_games g on g.season = p.season and g.stype = 2 and g.week = w and k.team in (g.away, g.home)
              where k.pool = p.id and k.user_id = u and k.slot = 'w' || w and g.final
                and (case when k.team = g.home then g.home_score <= g.away_score else g.away_score <= g.home_score end))
      or (not exists (select 1 from mm_picks k where k.pool = p.id and k.user_id = u and k.slot = 'w' || w)
          and (select max(kickoff) from pk_games where season = p.season and stype = 2 and week = w) <= now())));
$$;

-- pick (or change, or with a null team take back) a week's team until its game kicks off
create or replace function public.mm_pick_nfl(p_pool text, p_week int, p_team text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; g pk_games; cur text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make picks.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'nfl' then return jsonb_build_object('error', 'That isn''t an NFL survivor pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to pick.'); end if;
  if p_week < p.start_week or p_week > 18 then return jsonb_build_object('error', 'That week isn''t part of this pool.'); end if;
  select team into cur from mm_picks where pool = p.id and user_id = uid and slot = 'w' || p_week;
  if cur is not null and exists (select 1 from pk_games where season = p.season and stype = 2 and week = p_week and cur in (away, home) and kickoff <= now()) then
    return jsonb_build_object('error', 'Your pick for that week has kicked off. It''s locked.');
  end if;
  if not mm_nfl_alive(p.id, uid, p_week) then return jsonb_build_object('error', 'You''re out of this pool.'); end if;
  if p_team is null then delete from mm_picks where pool = p.id and user_id = uid and slot = 'w' || p_week; return jsonb_build_object('ok', true, 'team', null); end if;
  if not exists (select 1 from pk_games where season = p.season and stype = 2 and week = p_week) then return jsonb_build_object('error', 'That week''s games aren''t on the board yet.'); end if;
  select * into g from pk_games where season = p.season and stype = 2 and week = p_week and p_team in (away, home) order by kickoff limit 1;
  if not found then return jsonb_build_object('error', 'That team doesn''t play that week.'); end if;
  if g.kickoff <= now() then return jsonb_build_object('error', 'That game has kicked off.'); end if;
  if exists (select 1 from mm_picks where pool = p.id and user_id = uid and team = p_team and slot <> 'w' || p_week) then
    return jsonb_build_object('error', 'You''ve already used that team.');
  end if;
  insert into mm_picks (pool, user_id, slot, team) values (p.id, uid, 'w' || p_week, p_team)
  on conflict (pool, user_id, slot) do update set team = excluded.team, picked_at = now();
  return jsonb_build_object('ok', true, 'team', p_team);
end $$;

-- a pool's board, NFL survivor included: its weeks' games from pk_games, and picks shown at their game's kickoff
create or replace function public.mm_board(p_pool text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; lk timestamptz;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found then return jsonb_build_object('error', 'No pool has that code.'); end if;
  if uid is null or not exists (select 1 from mm_members where pool = p.id and user_id = uid) then
    return jsonb_build_object('error', 'join', 'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'startWeek', p.start_week,
      'members', (select count(*) from mm_members where pool = p.id)), 'signedIn', uid is not null);
  end if;
  if p.kind = 'nfl' then
    return jsonb_build_object('ok', true, 'now', now(),
      'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'startWeek', p.start_week, 'owner', p.owner = uid),
      'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'week', g.week, 'kickoff', g.kickoff, 'away', g.away, 'home', g.home,
          'ap', g.away_score, 'hp', g.home_score, 'final', g.final, 'status', g.status, 'line', coalesce(g.spread, g.live_spread))
        order by g.kickoff, g.game_id) from pk_games g where g.season = p.season and g.stype = 2 and g.week >= p.start_week), '[]'::jsonb),
      'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
      'picks', coalesce((select jsonb_agg(jsonb_build_object('user', k.user_id, 'slot', k.slot,
          'team', case when k.user_id = uid or exists (select 1 from pk_games g where g.season = p.season and g.stype = 2 and g.week = substring(k.slot from 2)::int
            and k.team in (g.away, g.home) and g.kickoff <= now()) then k.team end))
        from mm_picks k where k.pool = p.id), '[]'::jsonb));
  end if;
  lk := mm_five_lock(p.season);
  return jsonb_build_object('ok', true, 'now', now(), 'fiveLock', lk,
    'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = uid),
    'projected', exists (select 1 from mm_games where season = p.season and projected) and not exists (select 1 from mm_games where season = p.season and not projected),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'round', g.round, 'region', g.region, 'day', g.day, 'tip', g.tip,
        'a', g.a, 'b', g.b, 'as', g.a_seed, 'bs', g.b_seed, 'ap', g.a_score, 'bp', g.b_score, 'w', g.winner, 'status', g.status, 'final', g.final)
      order by g.tip, g.game_id) from mm_games g where g.season = p.season), '[]'::jsonb),
    'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('user', k.user_id, 'slot', k.slot,
        'team', case when k.user_id = uid then k.team
          when p.kind = 'five' and lk is not null and now() >= lk then k.team
          when p.kind = 'survivor' and exists (select 1 from mm_games g where g.season = p.season and g.round >= 1 and k.team in (g.a, g.b)
            and g.day = mm_day_date(p.season, substring(k.slot from 2)::int) and g.tip <= now()) then k.team end))
      from mm_picks k where k.pool = p.id), '[]'::jsonb));
end $$;

-- pools: NFL survivor pools start with the week they're made in (or the next one, once its games have all kicked off)
create or replace function public.mm_pool_create(p_name text, p_kind text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40); yr int; sw int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a pool.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  if p_kind not in ('survivor', 'five', 'nfl') then return jsonb_build_object('error', 'Pick a game.'); end if;
  if (select count(*) from mm_pools where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of pools. Leave one first.'); end if;
  if p_kind = 'nfl' then
    yr := mm_nfl_season(); sw := mm_nfl_start(yr);
    if sw is null then return jsonb_build_object('error', 'The next week''s games aren''t set yet. Try again in a day or two.'); end if;
    if sw > 18 then return jsonb_build_object('error', 'The regular season is over. NFL survivor comes back in September.'); end if;
  else
    yr := mm_season();
  end if;
  loop
    code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=0Oo1IiLl', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from mm_pools where id = code) and not exists (select 1 from pk_groups where id = code);
  end loop;
  insert into mm_pools (id, name, kind, season, owner, start_week) values (code, nm, p_kind, yr, uid, sw);
  insert into mm_members (pool, user_id, name) values (code, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''));
  return jsonb_build_object('ok', true, 'id', code, 'name', nm, 'kind', p_kind);
end $$;
create or replace function public.mm_pool_join(p_code text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to join a pool.'); end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_code, '')));
  if not found then
    if exists (select 1 from pk_groups where id = upper(trim(coalesce(p_code, '')))) then return jsonb_build_object('error', 'pickem', 'id', upper(trim(p_code))); end if;
    return jsonb_build_object('error', 'No pool has that code. Check it and try again.');
  end if;
  if (select count(*) from mm_members where pool = p.id) >= 200 then return jsonb_build_object('error', 'That pool is full.'); end if;
  if p.kind = 'nfl' and not exists (select 1 from mm_members where pool = p.id and user_id = uid)
     and (select max(kickoff) from pk_games where season = p.season and stype = 2 and week = p.start_week) <= now() then
    return jsonb_build_object('error', format('This pool started in week %s, and that week''s games have all kicked off. Make a new pool to play from this week.', p.start_week));
  end if;
  insert into mm_members (pool, user_id, name) values (p.id, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''))
  on conflict (pool, user_id) do update set name = coalesce(excluded.name, mm_members.name);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'kind', p.kind);
end $$;
create or replace function public.mm_pools_mine() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'startWeek', p.start_week, 'owner', p.owner = auth.uid(),
    'members', (select count(*) from mm_members where pool = p.id)) order by m.joined_at desc), '[]'::jsonb)
  from mm_members m join mm_pools p on p.id = m.pool where m.user_id = auth.uid();
$$;

revoke all on function public.mm_nfl_season(), public.mm_nfl_start(int), public.mm_nfl_alive(text, uuid, int) from public, anon, authenticated;
revoke all on function public.mm_pick_nfl(text, int, text) from public;
grant execute on function public.mm_pick_nfl(text, int, text) to authenticated;

select cron.unschedule('mm-sync') where exists (select 1 from cron.job where jobname = 'mm-sync');
select cron.schedule('mm-sync', '*/10 * * * *', $job$ select public.mm_sync(); $job$);
