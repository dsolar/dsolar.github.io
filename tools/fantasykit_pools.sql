-- Draft Lab's pools (fantasy/pools/): March Madness survivor and the 5-team game, season-long NFL survivor, and the
-- postseason pools, college bowl pick'em and the NFL playoff bracket (below). Built like the NFL pick'em
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

-- Postseason pools (fantasy/pools/): the college bowl pick'em ('bowls') and the NFL playoff bracket ('nflpo').
--   Bowls: pick the winner of every bowl and College Football Playoff game and give each a confidence number, 1 up to
--   the number of games, each number once. A right pick scores its number. Each game's pick and number lock at its
--   kickoff and show then. Most points wins; ties go to the most right picks, then the closest guess at the title
--   game's total points.
--   NFL bracket: the 14-team field from the standings, 7 seeds a conference. Pick the bracket before the first Wild Card
--   kickoff, reseeded the NFL's way (the top seed plays the lowest seed left). A team scores for every round it wins
--   that you had it winning: 1 for the Wild Card round, 2 divisional, 4 conference title, 8 Super Bowl. Ties go to the
--   closest guess at the Super Bowl's total points.
-- po_sync, on pg_cron every 10 minutes, reads ESPN through pg_net like pk_sync: the college football postseason
-- scoreboard, the NFL playoff weeks and, until the playoffs start, the NFL standings' playoff seeds.

create table if not exists public.po_games (
  game_id text primary key,
  comp text not null check (comp in ('cfb', 'nfl')), season int not null,
  round int not null,                   -- cfb: 0 a bowl, 1 CFP first round, 2 quarterfinal, 3 semifinal, 4 title game; nfl: 1 Wild Card ... 4 Super Bowl
  label text, conf text, kickoff timestamptz not null,
  a text, b text, a_name text, b_name text,   -- a away, b home (cfb by ESPN team id, nfl by abbreviation)
  a_score int, b_score int, winner text, line numeric, status text, final boolean not null default false,
  updated_at timestamptz not null default now());
create index if not exists po_games_comp on public.po_games (comp, season, kickoff);
create table if not exists public.po_field (
  comp text not null, season int not null, team text not null, conf text not null, seed int not null, name text,
  updated_at timestamptz not null default now(), primary key (comp, season, team));
create table if not exists public.po_sync_req (id bigint primary key, kind text not null, at timestamptz not null default now());
alter table public.po_games enable row level security;
alter table public.po_field enable row level security;
alter table public.po_sync_req enable row level security;

alter table public.mm_picks add column if not exists pts int;
alter table public.mm_pools drop constraint if exists mm_pools_kind_check;
alter table public.mm_pools add constraint mm_pools_kind_check check (kind in ('survivor', 'five', 'nfl', 'bowls', 'nflpo'));

-- the football season a postseason belongs to: this year's from July, last year's through June
create or replace function public.po_season() returns int
language sql stable as $$
  select case when extract(month from (now() at time zone 'America/New_York')) >= 7 then extract(year from now())::int else extract(year from now())::int - 1 end;
$$;
-- the NFL bracket locks at the first Wild Card kickoff
create or replace function public.po_nfl_lock(p_season int) returns timestamptz
language sql stable security definer set search_path to 'public' as $$
  select min(kickoff) from po_games where comp = 'nfl' and season = p_season and round = 1;
$$;

create or replace function public.po_sync() returns jsonb
language plpgsql security definer set search_path to 'public', 'net' as $$
declare r record; ev jsonb; c jsonb; h jsonb; a jsonb; ch jsonb; en jsonb; n int := 0; yr int := po_season(); hl text; rd int; wk int; sd int;
begin
  for r in select q.id, q.kind, x.content from po_sync_req q join net._http_response x on x.id = q.id where x.status_code = 200 loop
    begin
      if r.kind = 'std' then
        if po_nfl_lock(yr) is null or po_nfl_lock(yr) > now() then
          delete from po_field where comp = 'nfl' and season = yr;
          for ch in select * from jsonb_array_elements(r.content::jsonb -> 'children') loop
            for en in select * from jsonb_array_elements(ch -> 'standings' -> 'entries') loop
              select (s ->> 'value')::numeric::int into sd from jsonb_array_elements(en -> 'stats') s where s ->> 'name' = 'playoffSeed';
              if sd between 1 and 7 then
                insert into po_field (comp, season, team, conf, seed, name) values ('nfl', yr, en -> 'team' ->> 'abbreviation', ch ->> 'abbreviation', sd, en -> 'team' ->> 'displayName')
                on conflict (comp, season, team) do update set conf = excluded.conf, seed = excluded.seed, name = excluded.name, updated_at = now();
              end if;
            end loop;
          end loop;
        end if;
      else
        for ev in select * from jsonb_array_elements(r.content::jsonb -> 'events') loop
          c := ev -> 'competitions' -> 0;
          select x into h from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'home';
          select x into a from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'away';
          hl := c -> 'notes' -> 0 ->> 'headline';
          if r.kind = 'cfb' then
            rd := case when hl ilike '%playoff first round%' then 1 when hl ilike '%quarterfinal%' then 2 when hl ilike '%semifinal%' then 3 when hl ilike '%national championship%' then 4 else 0 end;
          else
            wk := (ev -> 'week' ->> 'number')::int;
            rd := case wk when 1 then 1 when 2 then 2 when 3 then 3 when 5 then 4 end;
            if rd is null then continue; end if;
          end if;
          insert into po_games (game_id, comp, season, round, label, conf, kickoff, a, b, a_name, b_name, a_score, b_score, winner, line, status, final, updated_at)
          values (ev ->> 'id', r.kind, coalesce((ev -> 'season' ->> 'year')::int, yr), rd, coalesce(hl, ev ->> 'name'),
            case when r.kind = 'nfl' then substring(hl from '^(AFC|NFC)') end, (ev ->> 'date')::timestamptz,
            case when (a -> 'team' ->> 'id')::int > 0 then case when r.kind = 'cfb' then a -> 'team' ->> 'id' else a -> 'team' ->> 'abbreviation' end end,
            case when (h -> 'team' ->> 'id')::int > 0 then case when r.kind = 'cfb' then h -> 'team' ->> 'id' else h -> 'team' ->> 'abbreviation' end end,
            case when (a -> 'team' ->> 'id')::int > 0 then a -> 'team' ->> 'displayName' end, case when (h -> 'team' ->> 'id')::int > 0 then h -> 'team' ->> 'displayName' end,
            nullif(a ->> 'score', '')::int, nullif(h ->> 'score', '')::int,
            case when coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false) then
              case when (h ->> 'winner')::boolean then case when r.kind = 'cfb' then h -> 'team' ->> 'id' else h -> 'team' ->> 'abbreviation' end
                   when (a ->> 'winner')::boolean then case when r.kind = 'cfb' then a -> 'team' ->> 'id' else a -> 'team' ->> 'abbreviation' end end end,
            (c -> 'odds' -> 0 ->> 'spread')::numeric, ev -> 'status' -> 'type' ->> 'name',
            coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false), now())
          on conflict (game_id) do update set round = excluded.round, label = excluded.label, conf = excluded.conf, kickoff = excluded.kickoff,
            a = excluded.a, b = excluded.b, a_name = excluded.a_name, b_name = excluded.b_name, a_score = excluded.a_score, b_score = excluded.b_score,
            winner = excluded.winner, status = excluded.status, final = excluded.final, updated_at = now(),
            line = case when excluded.kickoff > now() then coalesce(excluded.line, po_games.line) else po_games.line end;
          n := n + 1;
        end loop;
      end if;
    exception when others then null;
    end;
  end loop;
  delete from po_sync_req where id in (select q.id from po_sync_req q left join net._http_response x on x.id = q.id where x.id is not null or q.at < now() - interval '1 hour');
  insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?seasontype=3&groups=80&limit=300&dates=%s', yr), timeout_milliseconds => 20000), 'cfb';
  insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3&week=%s&dates=%s', w, yr), timeout_milliseconds => 20000), 'nfl' from unnest(array[1, 2, 3, 5]) w;
  if po_nfl_lock(yr) is null or po_nfl_lock(yr) > now() then
    insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=%s', yr), timeout_milliseconds => 20000), 'std';
  end if;
  return jsonb_build_object('saved', n);
end $$;

-- bowls: save your picks and numbers. Games that have kicked off keep what they had; every other game takes what you
-- send (a game you leave out is cleared). Numbers run 1 to the number of games, each once. tb: the title game's total.
create or replace function public.mm_save_bowls(p_pool text, p_picks jsonb, p_tb int default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; n int; x jsonb; g po_games; t text; v int; seen int[] := '{}'; saved int := 0; tlk timestamptz;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make picks.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'bowls' then return jsonb_build_object('error', 'That isn''t a bowl pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to pick.'); end if;
  select count(*) into n from po_games where comp = 'cfb' and season = p.season;
  if n = 0 then return jsonb_build_object('error', 'The bowl schedule isn''t out yet.'); end if;
  -- numbers already locked in on games that have started
  select coalesce(array_agg(k.pts), '{}') into seen from mm_picks k join po_games g2 on 'g' || g2.game_id = k.slot
    where k.pool = p.id and k.user_id = uid and k.pts is not null and g2.kickoff <= now();
  for x in select * from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) loop
    select * into g from po_games where game_id = x ->> 'game' and comp = 'cfb' and season = p.season;
    if not found or g.kickoff <= now() then continue; end if;
    t := coalesce(x ->> 'team', ''); v := nullif(x ->> 'pts', '')::int;
    if t <> '' and t not in (coalesce(g.a, ''), coalesce(g.b, '')) then return jsonb_build_object('error', format('That team isn''t in the %s.', g.label)); end if;
    if v is not null then
      if v < 1 or v > n then return jsonb_build_object('error', format('Numbers run from 1 to %s.', n)); end if;
      if v = any(seen) then return jsonb_build_object('error', format('You used %s twice. Each number goes on one game.', v)); end if;
      seen := seen || v;
    end if;
  end loop;
  delete from mm_picks k using po_games g2 where k.pool = p.id and k.user_id = uid and k.slot = 'g' || g2.game_id and g2.kickoff > now();
  for x in select * from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) loop
    select * into g from po_games where game_id = x ->> 'game' and comp = 'cfb' and season = p.season;
    if not found or g.kickoff <= now() then continue; end if;
    t := coalesce(x ->> 'team', ''); v := nullif(x ->> 'pts', '')::int;
    if t = '' and v is null then continue; end if;
    insert into mm_picks (pool, user_id, slot, team, pts) values (p.id, uid, 'g' || g.game_id, t, v)
    on conflict (pool, user_id, slot) do update set team = excluded.team, pts = excluded.pts, picked_at = now();
    saved := saved + 1;
  end loop;
  select kickoff into tlk from po_games where comp = 'cfb' and season = p.season and round = 4 order by kickoff limit 1;
  if p_tb is not null and (tlk is null or tlk > now()) then
    insert into mm_picks (pool, user_id, slot, team) values (p.id, uid, 'tb', greatest(0, least(200, p_tb))::text)
    on conflict (pool, user_id, slot) do update set team = excluded.team, picked_at = now();
  end if;
  return jsonb_build_object('ok', true, 'saved', saved);
end $$;

-- the NFL bracket: every pick at once, until the first Wild Card kickoff. Slots: A or N (the conference), then wc1..wc3
-- (the 2-7, 3-6 and 4-5 games), dv1 and dv2 (the top seed's game, then the other), cf; and sb.
create or replace function public.mm_save_nflpo(p_pool text, p_picks jsonb, p_tb int default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; lk timestamptz; k text; t text; cf text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make picks.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'nflpo' then return jsonb_build_object('error', 'That isn''t an NFL bracket pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to pick.'); end if;
  lk := po_nfl_lock(p.season);
  if lk is not null and now() >= lk then return jsonb_build_object('error', 'The playoffs have started. Brackets are locked.'); end if;
  if (select count(*) from po_field where comp = 'nfl' and season = p.season) < 14 then return jsonb_build_object('error', 'The playoff field isn''t set yet.'); end if;
  for k, t in select * from jsonb_each_text(coalesce(p_picks, '{}'::jsonb)) loop
    if k !~ '^(A|N)(wc[1-3]|dv[12]|cf)$' and k <> 'sb' then return jsonb_build_object('error', 'That isn''t a bracket slot.'); end if;
    select conf into cf from po_field where comp = 'nfl' and season = p.season and team = t;
    if cf is null then return jsonb_build_object('error', format('%s isn''t in the playoff field.', t)); end if;
    if k <> 'sb' and left(k, 1) <> left(cf, 1) then return jsonb_build_object('error', format('%s plays in the %s.', t, cf)); end if;
  end loop;
  delete from mm_picks where pool = p.id and user_id = uid;
  insert into mm_picks (pool, user_id, slot, team) select p.id, uid, key, value from jsonb_each_text(coalesce(p_picks, '{}'::jsonb));
  if p_tb is not null then insert into mm_picks (pool, user_id, slot, team) values (p.id, uid, 'tb', greatest(0, least(200, p_tb))::text); end if;
  return jsonb_build_object('ok', true);
end $$;

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
  if p.kind in ('bowls', 'nflpo') then
    lk := case when p.kind = 'nflpo' then po_nfl_lock(p.season) else (select min(kickoff) from po_games where comp = 'cfb' and season = p.season and round = 4) end;
    return jsonb_build_object('ok', true, 'now', now(), 'lock', lk,
      'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = uid),
      'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'round', g.round, 'label', g.label, 'conf', g.conf, 'kickoff', g.kickoff,
          'a', g.a, 'b', g.b, 'an', g.a_name, 'bn', g.b_name, 'ap', g.a_score, 'bp', g.b_score, 'w', g.winner, 'final', g.final, 'status', g.status, 'line', g.line)
        order by g.kickoff, g.game_id) from po_games g where g.comp = case when p.kind = 'bowls' then 'cfb' else 'nfl' end and g.season = p.season), '[]'::jsonb),
      'field', case when p.kind = 'nflpo' then coalesce((select jsonb_agg(jsonb_build_object('team', f.team, 'conf', f.conf, 'seed', f.seed, 'name', f.name) order by f.conf, f.seed)
        from po_field f where f.comp = 'nfl' and f.season = p.season), '[]'::jsonb) end,
      'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
      'picks', coalesce((select jsonb_agg(x) from (select jsonb_build_object('user', k.user_id, 'slot', k.slot, 'team', k.team, 'pts', k.pts) x
        from mm_picks k where k.pool = p.id and (k.user_id = uid
          or (k.slot = 'tb' and lk is not null and now() >= lk)
          or (p.kind = 'nflpo' and lk is not null and now() >= lk)
          or (p.kind = 'bowls' and exists (select 1 from po_games g where 'g' || g.game_id = k.slot and g.kickoff <= now())))) q), '[]'::jsonb));
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

create or replace function public.mm_pool_create(p_name text, p_kind text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40); yr int; sw int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a pool.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  if p_kind not in ('survivor', 'five', 'nfl', 'bowls', 'nflpo') then return jsonb_build_object('error', 'Pick a game.'); end if;
  if (select count(*) from mm_pools where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of pools. Leave one first.'); end if;
  if p_kind = 'nfl' then
    yr := mm_nfl_season(); sw := mm_nfl_start(yr);
    if sw is null then return jsonb_build_object('error', 'The next week''s games aren''t set yet. Try again in a day or two.'); end if;
    if sw > 18 then return jsonb_build_object('error', 'The regular season is over. NFL survivor comes back in September.'); end if;
  elsif p_kind in ('bowls', 'nflpo') then
    yr := po_season();
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
  if p.kind = 'nflpo' and not exists (select 1 from mm_members where pool = p.id and user_id = uid) and po_nfl_lock(p.season) <= now() then
    return jsonb_build_object('error', 'The playoffs have started, so this bracket pool is closed to new entries.');
  end if;
  insert into mm_members (pool, user_id, name) values (p.id, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''))
  on conflict (pool, user_id) do update set name = coalesce(excluded.name, mm_members.name);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'kind', p.kind);
end $$;

revoke all on function public.po_sync(), public.po_season(), public.po_nfl_lock(int) from public, anon, authenticated;
revoke all on function public.mm_save_bowls(text, jsonb, int), public.mm_save_nflpo(text, jsonb, int) from public;
grant execute on function public.mm_save_bowls(text, jsonb, int), public.mm_save_nflpo(text, jsonb, int) to authenticated;
select cron.unschedule('po-sync') where exists (select 1 from cron.job where jobname = 'po-sync');
select cron.schedule('po-sync', '*/10 * * * *', $job$ select public.po_sync(); $job$);

-- NFL playoff fantasy ('nflff'): a lineup each playoff round (QB, 2 RB, 2 WR, TE, FLEX, K, DEF) from the teams playing
-- that round, and each player only once all postseason. Each player locks at his game's kickoff and shows to everyone
-- then. Points are Sleeper's half-PPR totals (fk-live ?sport=nfl&post=N), added up over the four rounds.
alter table public.mm_pools drop constraint if exists mm_pools_kind_check;
alter table public.mm_pools add constraint mm_pools_kind_check check (kind in ('survivor', 'five', 'nfl', 'bowls', 'nflpo', 'nflff'));

create or replace function public.po_round_lock(p_season int, p_round int) returns timestamptz
language sql stable security definer set search_path to 'public' as $$
  select min(kickoff) from po_games where comp = 'nfl' and season = p_season and round = p_round;
$$;

-- a round's lineup: { "QB": "playerId@TEAM", "RB1": ..., ... }. Each player locks at his own game's kickoff, as in most
-- playoff fantasy contests: a spot whose player has kicked off keeps him whatever's sent; every other spot takes what's
-- sent (a spot left out is cleared). A player new to a spot has to be on a team playing this round, not yet kicked off.
create or replace function public.po_team_kick(p_season int, p_round int, p_team text) returns timestamptz
language sql stable security definer set search_path to 'public' as $$
  select min(kickoff) from po_games where comp = 'nfl' and season = p_season and round = p_round and p_team in (a, b);
$$;
create or replace function public.mm_save_nflff(p_pool text, p_round int, p_lineup jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; k text; v text; pid text; tm text; kick timestamptz; ids text[] := '{}'; used text; cur record; locked text[] := '{}';
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to set a lineup.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'nflff' then return jsonb_build_object('error', 'That isn''t a playoff fantasy pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to set a lineup.'); end if;
  if p_round not between 1 and 4 then return jsonb_build_object('error', 'That isn''t a playoff round.'); end if;
  if not exists (select 1 from po_games where comp = 'nfl' and season = p.season and round = p_round and a is not null and b is not null) then
    return jsonb_build_object('error', 'This round''s matchups aren''t set yet.');
  end if;
  -- spots already locked: their player's game has started
  for cur in select slot, team from mm_picks where pool = p.id and user_id = uid and slot ~ ('^r' || p_round || ':') loop
    if po_team_kick(p.season, p_round, split_part(cur.team, '@', 2)) <= now() then
      locked := locked || split_part(cur.slot, ':', 2); ids := ids || split_part(cur.team, '@', 1);
    end if;
  end loop;
  for k, v in select * from jsonb_each_text(coalesce(p_lineup, '{}'::jsonb)) loop
    if k not in ('QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF') then return jsonb_build_object('error', 'That isn''t a lineup spot.'); end if;
    if k = any(locked) or v is null or v = '' then continue; end if;
    pid := split_part(v, '@', 1); tm := split_part(v, '@', 2); kick := po_team_kick(p.season, p_round, tm);
    if kick is null then return jsonb_build_object('error', format('%s doesn''t play this round.', tm)); end if;
    if kick <= now() then return jsonb_build_object('error', 'One of those players has already kicked off.'); end if;
    if pid = any(ids) then return jsonb_build_object('error', 'A player can only fill one spot.'); end if;
    ids := ids || pid;
  end loop;
  select substring(slot from 2 for 1) into used from mm_picks
    where pool = p.id and user_id = uid and slot !~ ('^r' || p_round || ':') and split_part(team, '@', 1) = any(ids) limit 1;
  if used is not null then return jsonb_build_object('error', format('You already used one of those players in round %s. Each player plays once.', used)); end if;
  delete from mm_picks where pool = p.id and user_id = uid and slot ~ ('^r' || p_round || ':') and split_part(slot, ':', 2) <> all(locked);
  insert into mm_picks (pool, user_id, slot, team)
    select p.id, uid, 'r' || p_round || ':' || key, value from jsonb_each_text(coalesce(p_lineup, '{}'::jsonb)) where value <> '' and key <> all(locked);
  return jsonb_build_object('ok', true, 'locked', coalesce(array_length(locked, 1), 0));
end $$;
revoke all on function public.po_round_lock(int, int), public.po_team_kick(int, int, text) from public, anon, authenticated;
revoke all on function public.mm_save_nflff(text, int, jsonb) from public;
grant execute on function public.mm_save_nflff(text, int, jsonb) to authenticated;

alter table public.po_field add column if not exists pd numeric;
alter table public.po_field add column if not exists gp numeric;
create or replace function public.po_sync() returns jsonb
language plpgsql security definer set search_path to 'public', 'net' as $$
declare r record; ev jsonb; c jsonb; h jsonb; a jsonb; ch jsonb; en jsonb; n int := 0; yr int := po_season(); hl text; rd int; wk int; sd int; pdv numeric; gpv numeric;
begin
  for r in select q.id, q.kind, x.content from po_sync_req q join net._http_response x on x.id = q.id where x.status_code = 200 loop
    begin
      if r.kind = 'std' then
        if po_nfl_lock(yr) is null or po_nfl_lock(yr) > now() then
          delete from po_field where comp = 'nfl' and season = yr;
          for ch in select * from jsonb_array_elements(r.content::jsonb -> 'children') loop
            for en in select * from jsonb_array_elements(ch -> 'standings' -> 'entries') loop
              select (s ->> 'value')::numeric::int into sd from jsonb_array_elements(en -> 'stats') s where s ->> 'name' = 'playoffSeed';
              -- point differential and games played: the playoff fantasy planner's strength guess
              select coalesce(max((s ->> 'value')::numeric) filter (where s ->> 'name' in ('pointDifferential', 'differential')),
                       max((s ->> 'value')::numeric) filter (where s ->> 'name' = 'pointsFor') - max((s ->> 'value')::numeric) filter (where s ->> 'name' = 'pointsAgainst')),
                     sum((s ->> 'value')::numeric) filter (where s ->> 'name' in ('wins', 'losses', 'ties'))
                into pdv, gpv from jsonb_array_elements(en -> 'stats') s;
              if sd between 1 and 7 then
                insert into po_field (comp, season, team, conf, seed, name, pd, gp) values ('nfl', yr, en -> 'team' ->> 'abbreviation', ch ->> 'abbreviation', sd, en -> 'team' ->> 'displayName', pdv, gpv)
                on conflict (comp, season, team) do update set conf = excluded.conf, seed = excluded.seed, name = excluded.name, pd = excluded.pd, gp = excluded.gp, updated_at = now();
              end if;
            end loop;
          end loop;
        end if;
      else
        for ev in select * from jsonb_array_elements(r.content::jsonb -> 'events') loop
          c := ev -> 'competitions' -> 0;
          select x into h from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'home';
          select x into a from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'away';
          hl := c -> 'notes' -> 0 ->> 'headline';
          if r.kind = 'cfb' then
            rd := case when hl ilike '%playoff first round%' then 1 when hl ilike '%quarterfinal%' then 2 when hl ilike '%semifinal%' then 3 when hl ilike '%national championship%' then 4 else 0 end;
          else
            wk := (ev -> 'week' ->> 'number')::int;
            rd := case wk when 1 then 1 when 2 then 2 when 3 then 3 when 5 then 4 end;
            if rd is null then continue; end if;
          end if;
          insert into po_games (game_id, comp, season, round, label, conf, kickoff, a, b, a_name, b_name, a_score, b_score, winner, line, status, final, updated_at)
          values (ev ->> 'id', r.kind, coalesce((ev -> 'season' ->> 'year')::int, yr), rd, coalesce(hl, ev ->> 'name'),
            case when r.kind = 'nfl' then substring(hl from '^(AFC|NFC)') end, (ev ->> 'date')::timestamptz,
            case when (a -> 'team' ->> 'id')::int > 0 then case when r.kind = 'cfb' then a -> 'team' ->> 'id' else a -> 'team' ->> 'abbreviation' end end,
            case when (h -> 'team' ->> 'id')::int > 0 then case when r.kind = 'cfb' then h -> 'team' ->> 'id' else h -> 'team' ->> 'abbreviation' end end,
            case when (a -> 'team' ->> 'id')::int > 0 then a -> 'team' ->> 'displayName' end, case when (h -> 'team' ->> 'id')::int > 0 then h -> 'team' ->> 'displayName' end,
            nullif(a ->> 'score', '')::int, nullif(h ->> 'score', '')::int,
            case when coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false) then
              case when (h ->> 'winner')::boolean then case when r.kind = 'cfb' then h -> 'team' ->> 'id' else h -> 'team' ->> 'abbreviation' end
                   when (a ->> 'winner')::boolean then case when r.kind = 'cfb' then a -> 'team' ->> 'id' else a -> 'team' ->> 'abbreviation' end end end,
            (c -> 'odds' -> 0 ->> 'spread')::numeric, ev -> 'status' -> 'type' ->> 'name',
            coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false), now())
          on conflict (game_id) do update set round = excluded.round, label = excluded.label, conf = excluded.conf, kickoff = excluded.kickoff,
            a = excluded.a, b = excluded.b, a_name = excluded.a_name, b_name = excluded.b_name, a_score = excluded.a_score, b_score = excluded.b_score,
            winner = excluded.winner, status = excluded.status, final = excluded.final, updated_at = now(),
            line = case when excluded.kickoff > now() then coalesce(excluded.line, po_games.line) else po_games.line end;
          n := n + 1;
        end loop;
      end if;
    exception when others then null;
    end;
  end loop;
  delete from po_sync_req where id in (select q.id from po_sync_req q left join net._http_response x on x.id = q.id where x.id is not null or q.at < now() - interval '1 hour');
  insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?seasontype=3&groups=80&limit=300&dates=%s', yr), timeout_milliseconds => 20000), 'cfb';
  insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3&week=%s&dates=%s', w, yr), timeout_milliseconds => 20000), 'nfl' from unnest(array[1, 2, 3, 5]) w;
  if po_nfl_lock(yr) is null or po_nfl_lock(yr) > now() then
    insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=%s', yr), timeout_milliseconds => 20000), 'std';
  end if;
  return jsonb_build_object('saved', n);
end $$;

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
  if p.kind in ('bowls', 'nflpo', 'nflff') then
    lk := case when p.kind in ('nflpo', 'nflff') then po_nfl_lock(p.season) else (select min(kickoff) from po_games where comp = 'cfb' and season = p.season and round = 4) end;
    return jsonb_build_object('ok', true, 'now', now(), 'lock', lk,
      'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = uid),
      'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'round', g.round, 'label', g.label, 'conf', g.conf, 'kickoff', g.kickoff,
          'a', g.a, 'b', g.b, 'an', g.a_name, 'bn', g.b_name, 'ap', g.a_score, 'bp', g.b_score, 'w', g.winner, 'final', g.final, 'status', g.status, 'line', g.line)
        order by g.kickoff, g.game_id) from po_games g where g.comp = case when p.kind = 'bowls' then 'cfb' else 'nfl' end and g.season = p.season), '[]'::jsonb),
      'field', case when p.kind in ('nflpo', 'nflff') then coalesce((select jsonb_agg(jsonb_build_object('team', f.team, 'conf', f.conf, 'seed', f.seed, 'name', f.name, 'pd', f.pd, 'gp', f.gp) order by f.conf, f.seed)
        from po_field f where f.comp = 'nfl' and f.season = p.season), '[]'::jsonb) end,
      'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
      'picks', coalesce((select jsonb_agg(x) from (select jsonb_build_object('user', k.user_id, 'slot', k.slot, 'team', k.team, 'pts', k.pts) x
        from mm_picks k where k.pool = p.id and (k.user_id = uid
          or (k.slot = 'tb' and lk is not null and now() >= lk)
          or (p.kind = 'nflpo' and lk is not null and now() >= lk)
          or (p.kind = 'nflff' and k.slot ~ '^r[1-4]:' and po_team_kick(p.season, substring(k.slot from 2 for 1)::int, split_part(k.team, '@', 2)) <= now())
          or (p.kind = 'bowls' and exists (select 1 from po_games g where 'g' || g.game_id = k.slot and g.kickoff <= now())))) q), '[]'::jsonb));
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

create or replace function public.mm_pool_create(p_name text, p_kind text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40); yr int; sw int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a pool.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  if p_kind not in ('survivor', 'five', 'nfl', 'bowls', 'nflpo', 'nflff') then return jsonb_build_object('error', 'Pick a game.'); end if;
  if (select count(*) from mm_pools where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of pools. Leave one first.'); end if;
  if p_kind = 'nfl' then
    yr := mm_nfl_season(); sw := mm_nfl_start(yr);
    if sw is null then return jsonb_build_object('error', 'The next week''s games aren''t set yet. Try again in a day or two.'); end if;
    if sw > 18 then return jsonb_build_object('error', 'The regular season is over. NFL survivor comes back in September.'); end if;
  elsif p_kind in ('bowls', 'nflpo', 'nflff') then
    yr := po_season();
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

select cron.unschedule('mm-sync') where exists (select 1 from cron.job where jobname = 'mm-sync');
select cron.schedule('mm-sync', '*/10 * * * *', $job$ select public.mm_sync(); $job$);

-- Pick reminders: a member who turns them on gets one email when a pick is still missing about three hours before it's
-- due. The server clock (fk-clock, every five minutes) asks for each opted-in member's board as that member sees it
-- (mm_remind_boards), works out what's due with the pages' own rules (fantasy-kit/pools-core.js status), claims each
-- reminder once (mm_remind_claim), and sends it with Resend.
alter table public.mm_members add column if not exists remind boolean not null default false;
create table if not exists public.mm_reminded (
  pool text not null, user_id uuid not null, due timestamptz not null, sent_at timestamptz not null default now(),
  primary key (pool, user_id, due),
  foreign key (pool, user_id) references public.mm_members (pool, user_id) on delete cascade);
alter table public.mm_reminded enable row level security;
revoke all on public.mm_reminded from anon, authenticated;

create or replace function public.mm_remind_get(p_pool text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('remind', coalesce((select remind from mm_members where pool = upper(trim(p_pool)) and user_id = auth.uid()), false));
$$;
create or replace function public.mm_remind_set(p_pool text, p_on boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  update mm_members set remind = coalesce(p_on, false) where pool = upper(trim(p_pool)) and user_id = auth.uid();
  if not found then return jsonb_build_object('error', 'Join this pool first.'); end if;
  return jsonb_build_object('ok', true, 'remind', coalesce(p_on, false));
end $$;
revoke all on function public.mm_remind_get(text), public.mm_remind_set(text, boolean) from public, anon;
grant execute on function public.mm_remind_get(text), public.mm_remind_set(text, boolean) to authenticated;

-- every opted-in member's board, as mm_board gives it to them (their own picks, others' only once locked)
create or replace function public.mm_remind_boards(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare m record; out jsonb := '[]'::jsonb; b jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  for m in select mb.pool, mb.user_id, u.email, mm_name(mb.pool, mb.user_id) as nm, p.name as pool_name, p.kind
      from mm_members mb join mm_pools p on p.id = mb.pool join auth.users u on u.id = mb.user_id
      where mb.remind and u.email is not null loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', m.user_id, 'role', 'authenticated')::text, true);
    b := mm_board(m.pool);
    if b ? 'ok' then
      out := out || jsonb_build_array(jsonb_build_object('pool', m.pool, 'user', m.user_id, 'email', m.email, 'name', m.nm, 'pool_name', m.pool_name, 'kind', m.kind, 'board', b));
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('boards', out);
end $$;
-- claim reminders before sending: only the ones not already sent come back, so a deadline gets one email
create or replace function public.mm_remind_claim(p_token text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  with ins as (
    insert into mm_reminded (pool, user_id, due)
      select r ->> 'pool', (r ->> 'user')::uuid, to_timestamp((r ->> 'due')::numeric / 1000) from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    on conflict do nothing returning pool, user_id, due)
  select coalesce(jsonb_agg(jsonb_build_object('pool', pool, 'user', user_id, 'due', round(extract(epoch from due) * 1000))), '[]'::jsonb) into out from ins;
  delete from mm_reminded where sent_at < now() - interval '120 days';
  return jsonb_build_object('claimed', out);
end $$;
revoke all on function public.mm_remind_boards(text), public.mm_remind_claim(text, jsonb) from public, authenticated;
grant execute on function public.mm_remind_boards(text), public.mm_remind_claim(text, jsonb) to anon;

-- Super Bowl squares ('squares'): a 10 by 10 board, the AFC champion across the top and the NFC champion down the
-- side. Members claim squares (up to the pool's cap each; the owner can also put a name without an account on a
-- square). Once the numbers are drawn (the owner, or automatically half an hour before kickoff) the board locks. After
-- each quarter, the square at the last digit of each team's score wins that quarter's share. Nothing is paid here: the
-- price and shares only show what the pot would be.
alter table public.mm_pools add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.po_games add column if not exists lines jsonb;
alter table public.mm_pools drop constraint if exists mm_pools_kind_check;
alter table public.mm_pools add constraint mm_pools_kind_check check (kind in ('survivor', 'five', 'nfl', 'bowls', 'nflpo', 'nflff', 'squares'));

create or replace function public.po_sync() returns jsonb
language plpgsql security definer set search_path to 'public', 'net' as $$
declare r record; ev jsonb; c jsonb; h jsonb; a jsonb; ch jsonb; en jsonb; n int := 0; yr int := po_season(); hl text; rd int; wk int; sd int; pdv numeric; gpv numeric;
begin
  for r in select q.id, q.kind, x.content from po_sync_req q join net._http_response x on x.id = q.id where x.status_code = 200 loop
    begin
      if r.kind = 'std' then
        if po_nfl_lock(yr) is null or po_nfl_lock(yr) > now() then
          delete from po_field where comp = 'nfl' and season = yr;
          for ch in select * from jsonb_array_elements(r.content::jsonb -> 'children') loop
            for en in select * from jsonb_array_elements(ch -> 'standings' -> 'entries') loop
              select (s ->> 'value')::numeric::int into sd from jsonb_array_elements(en -> 'stats') s where s ->> 'name' = 'playoffSeed';
              -- point differential and games played: the playoff fantasy planner's strength guess
              select coalesce(max((s ->> 'value')::numeric) filter (where s ->> 'name' in ('pointDifferential', 'differential')),
                       max((s ->> 'value')::numeric) filter (where s ->> 'name' = 'pointsFor') - max((s ->> 'value')::numeric) filter (where s ->> 'name' = 'pointsAgainst')),
                     sum((s ->> 'value')::numeric) filter (where s ->> 'name' in ('wins', 'losses', 'ties'))
                into pdv, gpv from jsonb_array_elements(en -> 'stats') s;
              if sd between 1 and 7 then
                insert into po_field (comp, season, team, conf, seed, name, pd, gp) values ('nfl', yr, en -> 'team' ->> 'abbreviation', ch ->> 'abbreviation', sd, en -> 'team' ->> 'displayName', pdv, gpv)
                on conflict (comp, season, team) do update set conf = excluded.conf, seed = excluded.seed, name = excluded.name, pd = excluded.pd, gp = excluded.gp, updated_at = now();
              end if;
            end loop;
          end loop;
        end if;
      else
        for ev in select * from jsonb_array_elements(r.content::jsonb -> 'events') loop
          c := ev -> 'competitions' -> 0;
          select x into h from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'home';
          select x into a from jsonb_array_elements(c -> 'competitors') x where x ->> 'homeAway' = 'away';
          hl := c -> 'notes' -> 0 ->> 'headline';
          if r.kind = 'cfb' then
            rd := case when hl ilike '%playoff first round%' then 1 when hl ilike '%quarterfinal%' then 2 when hl ilike '%semifinal%' then 3 when hl ilike '%national championship%' then 4 else 0 end;
          else
            wk := (ev -> 'week' ->> 'number')::int;
            rd := case wk when 1 then 1 when 2 then 2 when 3 then 3 when 5 then 4 end;
            if rd is null then continue; end if;
          end if;
          insert into po_games (game_id, comp, season, round, label, conf, kickoff, a, b, a_name, b_name, a_score, b_score, winner, line, status, final, lines, updated_at)
          values (ev ->> 'id', r.kind, coalesce((ev -> 'season' ->> 'year')::int, yr), rd, coalesce(hl, ev ->> 'name'),
            case when r.kind = 'nfl' then substring(hl from '^(AFC|NFC)') end, (ev ->> 'date')::timestamptz,
            case when (a -> 'team' ->> 'id')::int > 0 then case when r.kind = 'cfb' then a -> 'team' ->> 'id' else a -> 'team' ->> 'abbreviation' end end,
            case when (h -> 'team' ->> 'id')::int > 0 then case when r.kind = 'cfb' then h -> 'team' ->> 'id' else h -> 'team' ->> 'abbreviation' end end,
            case when (a -> 'team' ->> 'id')::int > 0 then a -> 'team' ->> 'displayName' end, case when (h -> 'team' ->> 'id')::int > 0 then h -> 'team' ->> 'displayName' end,
            nullif(a ->> 'score', '')::int, nullif(h ->> 'score', '')::int,
            case when coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false) then
              case when (h ->> 'winner')::boolean then case when r.kind = 'cfb' then h -> 'team' ->> 'id' else h -> 'team' ->> 'abbreviation' end
                   when (a ->> 'winner')::boolean then case when r.kind = 'cfb' then a -> 'team' ->> 'id' else a -> 'team' ->> 'abbreviation' end end end,
            (c -> 'odds' -> 0 ->> 'spread')::numeric, ev -> 'status' -> 'type' ->> 'name',
            coalesce((ev -> 'status' -> 'type' ->> 'completed')::boolean, false),
            -- each quarter's points (and overtime), for squares: { a: [7, 3, ...], b: [...] }
            case when jsonb_array_length(coalesce(a -> 'linescores', '[]'::jsonb)) > 0 then jsonb_build_object(
              'a', (select jsonb_agg(coalesce((x ->> 'value')::numeric::int, 0) order by o) from jsonb_array_elements(a -> 'linescores') with ordinality t(x, o)),
              'b', (select jsonb_agg(coalesce((x ->> 'value')::numeric::int, 0) order by o) from jsonb_array_elements(h -> 'linescores') with ordinality t(x, o))) end,
            now())
          on conflict (game_id) do update set round = excluded.round, label = excluded.label, conf = excluded.conf, kickoff = excluded.kickoff,
            a = excluded.a, b = excluded.b, a_name = excluded.a_name, b_name = excluded.b_name, a_score = excluded.a_score, b_score = excluded.b_score,
            winner = excluded.winner, status = excluded.status, final = excluded.final, lines = coalesce(excluded.lines, po_games.lines), updated_at = now(),
            line = case when excluded.kickoff > now() then coalesce(excluded.line, po_games.line) else po_games.line end;
          n := n + 1;
        end loop;
      end if;
    exception when others then null;
    end;
  end loop;
  delete from po_sync_req where id in (select q.id from po_sync_req q left join net._http_response x on x.id = q.id where x.id is not null or q.at < now() - interval '1 hour');
  insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?seasontype=3&groups=80&limit=300&dates=%s', yr), timeout_milliseconds => 20000), 'cfb';
  insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=3&week=%s&dates=%s', w, yr), timeout_milliseconds => 20000), 'nfl' from unnest(array[1, 2, 3, 5]) w;
  if po_nfl_lock(yr) is null or po_nfl_lock(yr) > now() then
    insert into po_sync_req (id, kind) select net.http_get(format('https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=%s', yr), timeout_milliseconds => 20000), 'std';
  end if;
  return jsonb_build_object('saved', n);
end $$;

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
  if p.kind in ('bowls', 'nflpo', 'nflff', 'squares') then
    lk := case when p.kind in ('nflpo', 'nflff') then po_nfl_lock(p.season) when p.kind = 'squares' then (select min(kickoff) from po_games where comp = 'nfl' and season = p.season and round = 4) else (select min(kickoff) from po_games where comp = 'cfb' and season = p.season and round = 4) end;
    return jsonb_build_object('ok', true, 'now', now(), 'lock', lk,
      'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = uid, 'extra', p.extra),
      'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'round', g.round, 'label', g.label, 'conf', g.conf, 'kickoff', g.kickoff,
          'a', g.a, 'b', g.b, 'an', g.a_name, 'bn', g.b_name, 'ap', g.a_score, 'bp', g.b_score, 'w', g.winner, 'final', g.final, 'status', g.status, 'line', g.line, 'lines', g.lines)
        order by g.kickoff, g.game_id) from po_games g where g.comp = case when p.kind = 'bowls' then 'cfb' else 'nfl' end and g.season = p.season), '[]'::jsonb),
      'field', case when p.kind in ('nflpo', 'nflff', 'squares') then coalesce((select jsonb_agg(jsonb_build_object('team', f.team, 'conf', f.conf, 'seed', f.seed, 'name', f.name, 'pd', f.pd, 'gp', f.gp) order by f.conf, f.seed)
        from po_field f where f.comp = 'nfl' and f.season = p.season), '[]'::jsonb) end,
      'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
      'picks', coalesce((select jsonb_agg(x) from (select jsonb_build_object('user', k.user_id, 'slot', k.slot, 'team', k.team, 'pts', k.pts) x
        from mm_picks k where k.pool = p.id and (k.user_id = uid
          or (k.slot = 'tb' and lk is not null and now() >= lk)
          or (p.kind = 'nflpo' and lk is not null and now() >= lk)
          or p.kind = 'squares'
          or (p.kind = 'nflff' and k.slot ~ '^r[1-4]:' and po_team_kick(p.season, substring(k.slot from 2 for 1)::int, split_part(k.team, '@', 2)) <= now())
          or (p.kind = 'bowls' and exists (select 1 from po_games g where 'g' || g.game_id = k.slot and g.kickoff <= now())))) q), '[]'::jsonb));
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

create or replace function public.mm_pool_create(p_name text, p_kind text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40); yr int; sw int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a pool.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  if p_kind not in ('survivor', 'five', 'nfl', 'bowls', 'nflpo', 'nflff', 'squares') then return jsonb_build_object('error', 'Pick a game.'); end if;
  if (select count(*) from mm_pools where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of pools. Leave one first.'); end if;
  if p_kind = 'nfl' then
    yr := mm_nfl_season(); sw := mm_nfl_start(yr);
    if sw is null then return jsonb_build_object('error', 'The next week''s games aren''t set yet. Try again in a day or two.'); end if;
    if sw > 18 then return jsonb_build_object('error', 'The regular season is over. NFL survivor comes back in September.'); end if;
  elsif p_kind in ('bowls', 'nflpo', 'nflff', 'squares') then
    yr := po_season();
  else
    yr := mm_season();
  end if;
  loop
    code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=0Oo1IiLl', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from mm_pools where id = code) and not exists (select 1 from pk_groups where id = code);
  end loop;
  insert into mm_pools (id, name, kind, season, owner, start_week, extra) values (code, nm, p_kind, yr, uid, sw,
    case when p_kind = 'squares' then '{"cap": 10, "pay": [20, 20, 20, 40]}'::jsonb else '{}'::jsonb end);
  insert into mm_members (pool, user_id, name) values (code, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''));
  return jsonb_build_object('ok', true, 'id', code, 'name', nm, 'kind', p_kind);
end $$;

create or replace function public.mm_save_nflff(p_pool text, p_round int, p_lineup jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; k text; v text; pid text; tm text; kick timestamptz; ids text[] := '{}'; used text; cur record; locked text[] := '{}'; proj boolean;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to set a lineup.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'nflff' then return jsonb_build_object('error', 'That isn''t a playoff fantasy pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to set a lineup.'); end if;
  if p_round not between 1 and 4 then return jsonb_build_object('error', 'That isn''t a playoff round.'); end if;
  -- before week 18 ends, the Wild Card round plays from projected matchups: the 2 through 7 seeds if the season ended
  -- today. A player whose team falls out of the field by then just scores nothing.
  proj := p_round = 1 and not exists (select 1 from po_games where comp = 'nfl' and season = p.season and round = 1 and a is not null and b is not null)
    and (select count(*) from po_field where comp = 'nfl' and season = p.season and seed between 2 and 7) = 12;
  if not proj and not exists (select 1 from po_games where comp = 'nfl' and season = p.season and round = p_round and a is not null and b is not null) then
    return jsonb_build_object('error', 'This round''s matchups aren''t set yet.');
  end if;
  -- spots already locked: their player's game has started
  for cur in select slot, team from mm_picks where pool = p.id and user_id = uid and slot ~ ('^r' || p_round || ':') loop
    if po_team_kick(p.season, p_round, split_part(cur.team, '@', 2)) <= now() then
      locked := locked || split_part(cur.slot, ':', 2); ids := ids || split_part(cur.team, '@', 1);
    end if;
  end loop;
  for k, v in select * from jsonb_each_text(coalesce(p_lineup, '{}'::jsonb)) loop
    if k not in ('QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF') then return jsonb_build_object('error', 'That isn''t a lineup spot.'); end if;
    if k = any(locked) or v is null or v = '' then continue; end if;
    pid := split_part(v, '@', 1); tm := split_part(v, '@', 2); kick := po_team_kick(p.season, p_round, tm);
    if proj then
      kick := case when exists (select 1 from po_field where comp = 'nfl' and season = p.season and team = tm and seed between 2 and 7)
        then coalesce(po_round_lock(p.season, 1), now() + interval '1 day') end;
    end if;
    if kick is null then return jsonb_build_object('error', format('%s doesn''t play this round.', tm)); end if;
    if kick <= now() then return jsonb_build_object('error', 'One of those players has already kicked off.'); end if;
    if pid = any(ids) then return jsonb_build_object('error', 'A player can only fill one spot.'); end if;
    ids := ids || pid;
  end loop;
  select substring(slot from 2 for 1) into used from mm_picks
    where pool = p.id and user_id = uid and slot !~ ('^r' || p_round || ':') and split_part(team, '@', 1) = any(ids) limit 1;
  if used is not null then return jsonb_build_object('error', format('You already used one of those players in round %s. Each player plays once.', used)); end if;
  delete from mm_picks where pool = p.id and user_id = uid and slot ~ ('^r' || p_round || ':') and split_part(slot, ':', 2) <> all(locked);
  insert into mm_picks (pool, user_id, slot, team)
    select p.id, uid, 'r' || p_round || ':' || key, value from jsonb_each_text(coalesce(p_lineup, '{}'::jsonb)) where value <> '' and key <> all(locked);
  return jsonb_build_object('ok', true, 'locked', coalesce(array_length(locked, 1), 0), 'projected', proj);
end $$;

-- claim or let go of a square. p_name: the owner putting someone without an account on it (no cap for those)
create or replace function public.mm_squares_claim(p_pool text, p_sq int, p_on boolean, p_name text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; who uuid; cur text; n int; nm text := nullif(left(trim(coalesce(p_name, '')), 24), '');
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, ''))) for update;
  if not found or p.kind <> 'squares' then return jsonb_build_object('error', 'That isn''t a squares pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool first.'); end if;
  if p_sq is null or p_sq not between 0 and 99 then return jsonb_build_object('error', 'That isn''t a square.'); end if;
  if p.extra ? 'nums' then return jsonb_build_object('error', 'The numbers are drawn, so the board is locked.'); end if;
  if nm is not null and p.owner <> uid then return jsonb_build_object('error', 'Only the pool''s owner can add names.'); end if;
  select user_id, team into who, cur from mm_picks where pool = p.id and slot = 's' || p_sq;
  if coalesce(p_on, true) then
    if who is not null then
      if who = uid and (nm is null) = (cur = 'x') then return jsonb_build_object('ok', true); end if;
      if who <> uid or nm is null then return jsonb_build_object('error', 'Someone already has that square.'); end if;
    end if;
    if nm is null then
      select count(*) into n from mm_picks where pool = p.id and user_id = uid and slot ~ '^s\d+$' and team = 'x';
      if n >= coalesce((p.extra ->> 'cap')::int, 10) then return jsonb_build_object('error', format('That''s your %s squares, the most anyone can have here.', n)); end if;
    end if;
    insert into mm_picks (pool, user_id, slot, team) values (p.id, uid, 's' || p_sq, case when nm is null then 'x' else 'n:' || nm end)
      on conflict (pool, user_id, slot) do update set team = excluded.team, picked_at = now();
  else
    if who is null then return jsonb_build_object('ok', true); end if;
    if who <> uid and p.owner <> uid then return jsonb_build_object('error', 'That square isn''t yours.'); end if;
    delete from mm_picks where pool = p.id and slot = 's' || p_sq;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- the owner's settings, before the draw: most squares a person can claim, the price of a square, each quarter's share
create or replace function public.mm_squares_set(p_pool text, p_cap int, p_price numeric, p_pay int[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, ''))) for update;
  if not found or p.kind <> 'squares' then return jsonb_build_object('error', 'That isn''t a squares pool.'); end if;
  if p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can change that.'); end if;
  if p.extra ? 'nums' then return jsonb_build_object('error', 'The numbers are drawn, so the settings are locked.'); end if;
  if p_cap is null or p_cap not between 1 and 100 then return jsonb_build_object('error', 'Pick a limit from 1 to 100 squares.'); end if;
  if p_price is not null and (p_price < 0 or p_price > 10000) then return jsonb_build_object('error', 'That price doesn''t look right.'); end if;
  if p_pay is null or array_length(p_pay, 1) <> 4 or (select sum(x) from unnest(p_pay) x) <> 100 or exists (select 1 from unnest(p_pay) x where x < 0) then
    return jsonb_build_object('error', 'The four shares have to add up to 100%.');
  end if;
  update mm_pools set extra = extra || jsonb_build_object('cap', p_cap, 'price', p_price, 'pay', to_jsonb(p_pay)) where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mm_squares_shuffle() returns jsonb language sql volatile as $$
  select jsonb_build_object('r', (select jsonb_agg(x order by random()) from generate_series(0, 9) x),
                            'c', (select jsonb_agg(x order by random()) from generate_series(0, 9) x));
$$;
create or replace function public.mm_squares_draw(p_pool text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, ''))) for update;
  if not found or p.kind <> 'squares' then return jsonb_build_object('error', 'That isn''t a squares pool.'); end if;
  if p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can draw the numbers.'); end if;
  if p.extra ? 'nums' then return jsonb_build_object('error', 'The numbers are already drawn.'); end if;
  update mm_pools set extra = extra || jsonb_build_object('nums', mm_squares_shuffle(), 'drawn', now()) where id = p.id;
  return jsonb_build_object('ok', true);
end $$;
-- numbers nobody drew get drawn half an hour before the Super Bowl
create or replace function public.mm_squares_autodraw() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update mm_pools p set extra = p.extra || jsonb_build_object('nums', mm_squares_shuffle(), 'drawn', now(), 'auto', true)
  where p.kind = 'squares' and not (p.extra ? 'nums')
    and exists (select 1 from po_games g where g.comp = 'nfl' and g.season = p.season and g.round = 4 and g.kickoff - interval '30 minutes' <= now()
      and g.kickoff > now() - interval '1 day');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mm_squares_shuffle(), public.mm_squares_autodraw() from public, anon, authenticated;
revoke all on function public.mm_squares_claim(text, int, boolean, text), public.mm_squares_set(text, int, numeric, int[]), public.mm_squares_draw(text) from public, anon;
grant execute on function public.mm_squares_claim(text, int, boolean, text), public.mm_squares_set(text, int, numeric, int[]), public.mm_squares_draw(text) to authenticated;
select cron.unschedule('squares-draw') where exists (select 1 from cron.job where jobname = 'squares-draw');
select cron.schedule('squares-draw', '*/10 * * * *', $job$ select public.mm_squares_autodraw(); $job$);

-- Pool settings: an owner renames the pool, sets the game's options, removes a member or deletes the pool; anyone
-- renames their own entry (leaving is mm_pool_leave).
create or replace function public.mm_pool_update(p_pool text, p_name text, p_settings jsonb default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; nm text := left(trim(coalesce(p_name, '')), 40); sc text;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, ''))) for update;
  if not found then return jsonb_build_object('error', 'No pool has that code.'); end if;
  if p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can change that.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  -- playoff fantasy's scoring, until the first lineup locks
  sc := p_settings ->> 'scoring';
  if sc is not null then
    if p.kind <> 'nflff' or sc not in ('half', 'ppr', 'std') then return jsonb_build_object('error', 'That isn''t a scoring this game has.'); end if;
    if po_round_lock(p.season, 1) <= now() then return jsonb_build_object('error', 'The playoffs have started, so the scoring is set.'); end if;
  end if;
  update mm_pools set name = nm, extra = case when sc is null then extra else extra || jsonb_build_object('scoring', sc) end where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mm_entry_rename(p_pool text, p_name text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  update mm_members set name = nullif(left(trim(coalesce(p_name, '')), 28), '') where pool = upper(trim(coalesce(p_pool, ''))) and user_id = auth.uid();
  if not found then return jsonb_build_object('error', 'Join this pool first.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- an owner takes someone out of the pool (their picks go with them)
create or replace function public.mm_member_remove(p_pool text, p_user uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p mm_pools;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found or p.owner is distinct from auth.uid() then return jsonb_build_object('error', 'Only the pool''s owner can remove someone.'); end if;
  if p_user = p.owner then return jsonb_build_object('error', 'You own the pool, so you can''t remove yourself.'); end if;
  delete from mm_members where pool = p.id and user_id = p_user;
  if not found then return jsonb_build_object('error', 'They aren''t in this pool.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- an owner deletes the pool and everything in it
create or replace function public.mm_pool_delete(p_pool text, p_confirm text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p mm_pools;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found or p.owner is distinct from auth.uid() then return jsonb_build_object('error', 'Only the pool''s owner can delete it.'); end if;
  if upper(trim(coalesce(p_confirm, ''))) <> p.id then return jsonb_build_object('error', 'Type the pool''s code to delete it.'); end if;
  delete from mm_pools where id = p.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.mm_pool_update(text, text, jsonb), public.mm_entry_rename(text, text), public.mm_member_remove(text, uuid), public.mm_pool_delete(text, text) from public, anon;
grant execute on function public.mm_pool_update(text, text, jsonb), public.mm_entry_rename(text, text), public.mm_member_remove(text, uuid), public.mm_pool_delete(text, text) to authenticated;

-- Commissioner tools: a buy-in and who's paid (tracked only; no money moves here), payout shares, a pinned message,
-- closing the pool to new entries, past champions, and handing the pool to someone else.
alter table public.mm_members add column if not exists paid boolean not null default false;

-- mm_board, as before, plus the pool's settings for every game and each member's paid mark
alter function public.mm_board(text) rename to mm_board_core;
create or replace function public.mm_board(p_pool text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare b jsonb; p mm_pools;
begin
  b := mm_board_core(p_pool);
  if not (b ? 'ok') then return b; end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  b := jsonb_set(b, '{pool,extra}', coalesce(p.extra, '{}'::jsonb));
  b := jsonb_set(b, '{members}', coalesce((select jsonb_agg(m.v || jsonb_build_object('paid', coalesce(mb.paid, false), 'owner', mb.user_id = p.owner) order by m.o)
    from jsonb_array_elements(b -> 'members') with ordinality m(v, o) left join mm_members mb on mb.pool = p.id and mb.user_id = (m.v ->> 'id')::uuid), '[]'::jsonb));
  return b;
end $$;
revoke all on function public.mm_board_core(text) from public, anon, authenticated;
grant execute on function public.mm_board(text) to anon, authenticated;

create or replace function public.mm_pool_extra(p_pool text, p_set jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p mm_pools; e jsonb := '{}'::jsonb; v jsonb;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, ''))) for update;
  if not found or p.owner is distinct from auth.uid() then return jsonb_build_object('error', 'Only the pool''s owner can change that.'); end if;
  if p_set ? 'note' then e := e || jsonb_build_object('note', nullif(left(trim(coalesce(p_set ->> 'note', '')), 500), '')); end if;
  if p_set ? 'buyin' then
    v := p_set -> 'buyin';
    if jsonb_typeof(v) = 'number' and ((v)::text::numeric < 0 or (v)::text::numeric > 10000) then return jsonb_build_object('error', 'That buy-in doesn''t look right.'); end if;
    e := e || jsonb_build_object('buyin', case when jsonb_typeof(v) = 'number' and (v)::text::numeric > 0 then v end);
  end if;
  if p_set ? 'payouts' then
    v := p_set -> 'payouts';
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 5
       or (select sum((x)::text::numeric) from jsonb_array_elements(v) x) <> 100
       or exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'number' or (x)::text::numeric < 0) then
      return jsonb_build_object('error', 'The payout shares have to add up to 100%.');
    end if;
    e := e || jsonb_build_object('payouts', v);
  end if;
  if p_set ? 'closed' then e := e || jsonb_build_object('closed', coalesce((p_set ->> 'closed')::boolean, false)); end if;
  if p_set ? 'champs' then
    v := p_set -> 'champs';
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 30 then return jsonb_build_object('error', 'That list of champions doesn''t look right.'); end if;
    e := e || jsonb_build_object('champs', coalesce((select jsonb_agg(jsonb_build_object('year', left(trim(coalesce(x ->> 'year', '')), 9), 'name', left(trim(coalesce(x ->> 'name', '')), 40)))
      from jsonb_array_elements(v) x where trim(coalesce(x ->> 'name', '')) <> ''), '[]'::jsonb));
  end if;
  -- a cleared note or buy-in comes off
  update mm_pools set extra = (extra || e) - (case when e ? 'note' and e ->> 'note' is null then 'note' else '' end) - (case when e ? 'buyin' and e ->> 'buyin' is null then 'buyin' else '' end) where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mm_member_paid(p_pool text, p_user uuid, p_paid boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p mm_pools;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found or p.owner is distinct from auth.uid() then return jsonb_build_object('error', 'Only the pool''s owner can mark who''s paid.'); end if;
  update mm_members set paid = coalesce(p_paid, false) where pool = p.id and user_id = p_user;
  if not found then return jsonb_build_object('error', 'They aren''t in this pool.'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mm_pool_transfer(p_pool text, p_user uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p mm_pools;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, ''))) for update;
  if not found or p.owner is distinct from auth.uid() then return jsonb_build_object('error', 'Only the pool''s owner can hand it over.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = p_user) then return jsonb_build_object('error', 'They aren''t in this pool.'); end if;
  if (select count(*) from mm_pools where owner = p_user) >= 20 then return jsonb_build_object('error', 'They already own 20 pools.'); end if;
  update mm_pools set owner = p_user where id = p.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.mm_pool_extra(text, jsonb), public.mm_member_paid(text, uuid, boolean), public.mm_pool_transfer(text, uuid) from public, anon;
grant execute on function public.mm_pool_extra(text, jsonb), public.mm_member_paid(text, uuid, boolean), public.mm_pool_transfer(text, uuid) to authenticated;

-- a closed pool takes no new entries
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
  if coalesce((p.extra ->> 'closed')::boolean, false) and not exists (select 1 from mm_members where pool = p.id and user_id = uid) then
    return jsonb_build_object('error', 'The owner closed this pool to new entries.');
  end if;
  if (select count(*) from mm_members where pool = p.id) >= 200 then return jsonb_build_object('error', 'That pool is full.'); end if;
  if p.kind = 'nfl' and not exists (select 1 from mm_members where pool = p.id and user_id = uid)
     and (select max(kickoff) from pk_games where season = p.season and stype = 2 and week = p.start_week) <= now() then
    return jsonb_build_object('error', format('This pool started in week %s, and that week''s games have all kicked off. Make a new pool to play from this week.', p.start_week));
  end if;
  if p.kind = 'nflpo' and not exists (select 1 from mm_members where pool = p.id and user_id = uid) and po_nfl_lock(p.season) <= now() then
    return jsonb_build_object('error', 'The playoffs have started, so this bracket pool is closed to new entries.');
  end if;
  insert into mm_members (pool, user_id, name) values (p.id, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''))
  on conflict (pool, user_id) do update set name = coalesce(excluded.name, mm_members.name);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'kind', p.kind);
end $$;

-- The owner makes a pick for a member (a friend who texted his pick): the member's own board and save functions, run
-- as that member, so every lock and rule still applies. Each time is written to mm_log, which the whole pool sees.
create table if not exists public.mm_log (
  id bigserial primary key, pool text not null references public.mm_pools (id) on delete cascade,
  at timestamptz not null default now(), actor uuid, target uuid, what text not null);
create index if not exists mm_log_pool on public.mm_log (pool, at desc);
alter table public.mm_log enable row level security;
revoke all on public.mm_log from anon, authenticated;

create or replace function public.mm_board_as(p_pool text, p_user uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; old text := current_setting('request.jwt.claims', true); b jsonb;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can make picks for someone.'); end if;
  if p_user = uid or not exists (select 1 from mm_members where pool = p.id and user_id = p_user) then return jsonb_build_object('error', 'They aren''t in this pool.'); end if;
  insert into mm_log (pool, actor, target, what) values (p.id, uid, p_user, 'opened the picks of');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  begin b := mm_board(p.id); exception when others then perform set_config('request.jwt.claims', coalesce(old, ''), true); raise; end;
  perform set_config('request.jwt.claims', coalesce(old, ''), true);
  return b || jsonb_build_object('as', jsonb_build_object('id', p_user, 'name', mm_name(p.id, p_user)));
end $$;

create or replace function public.mm_as(p_pool text, p_user uuid, p_fn text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p mm_pools; old text := current_setting('request.jwt.claims', true); r jsonb; a jsonb := coalesce(p_args, '{}'::jsonb);
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can make picks for someone.'); end if;
  if p_user = uid or not exists (select 1 from mm_members where pool = p.id and user_id = p_user) then return jsonb_build_object('error', 'They aren''t in this pool.'); end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  begin
    r := case p_fn
      when 'mm_pick' then mm_pick(p.id, (a ->> 'p_day')::int, a ->> 'p_team')
      when 'mm_pick_nfl' then mm_pick_nfl(p.id, (a ->> 'p_week')::int, a ->> 'p_team')
      when 'mm_pick_five' then mm_pick_five(p.id, array(select jsonb_array_elements_text(a -> 'p_teams')))
      when 'mm_save_bowls' then mm_save_bowls(p.id, a -> 'p_picks', (a ->> 'p_tb')::int)
      when 'mm_save_nflpo' then mm_save_nflpo(p.id, a -> 'p_picks', (a ->> 'p_tb')::int)
      when 'mm_save_nflff' then mm_save_nflff(p.id, (a ->> 'p_round')::int, a -> 'p_lineup')
      else jsonb_build_object('error', 'That isn''t a pick the owner can make.') end;
  exception when others then perform set_config('request.jwt.claims', coalesce(old, ''), true); raise;
  end;
  perform set_config('request.jwt.claims', coalesce(old, ''), true);
  if r is not null and not (r ? 'error') then
    insert into mm_log (pool, actor, target, what) values (p.id, uid, p_user, case p_fn when 'mm_save_nflff' then 'set a lineup for' when 'mm_save_nflpo' then 'filled out the bracket of'
      when 'mm_save_bowls' then 'saved bowl picks for' when 'mm_pick_five' then 'picked five teams for' else 'made a pick for' end);
  end if;
  return r;
end $$;
revoke all on function public.mm_board_as(text, uuid), public.mm_as(text, uuid, text, jsonb) from public, anon;
grant execute on function public.mm_board_as(text, uuid), public.mm_as(text, uuid, text, jsonb) to authenticated;

-- the board carries the pool's log (newest first), so everyone sees what the owner did
create or replace function public.mm_board(p_pool text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare b jsonb; p mm_pools;
begin
  b := mm_board_core(p_pool);
  if not (b ? 'ok') then return b; end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  b := jsonb_set(b, '{pool,extra}', coalesce(p.extra, '{}'::jsonb));
  b := jsonb_set(b, '{members}', coalesce((select jsonb_agg(m.v || jsonb_build_object('paid', coalesce(mb.paid, false), 'owner', mb.user_id = p.owner) order by m.o)
    from jsonb_array_elements(b -> 'members') with ordinality m(v, o) left join mm_members mb on mb.pool = p.id and mb.user_id = (m.v ->> 'id')::uuid), '[]'::jsonb));
  b := b || jsonb_build_object('log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'who', mm_name(p.id, l.actor), 'what', l.what, 'whom', mm_name(p.id, l.target)) order by l.at desc)
    from (select * from mm_log where pool = p.id order by at desc limit 12) l), '[]'::jsonb));
  return b;
end $$;

-- Weekly recap emails: members who turn them on get a Tuesday-morning note on each pool with a game that finished in
-- the last week (fk-clock builds it with fantasy-kit/pools-core.js recap). mm_recapped makes sure it's once a week.
alter table public.mm_members add column if not exists recap boolean not null default false;
create table if not exists public.mm_recapped (
  pool text not null, user_id uuid not null, wk date not null, sent_at timestamptz not null default now(),
  primary key (pool, user_id, wk),
  foreign key (pool, user_id) references public.mm_members (pool, user_id) on delete cascade);
alter table public.mm_recapped enable row level security;
revoke all on public.mm_recapped from anon, authenticated;

create or replace function public.mm_remind_get(p_pool text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('remind', coalesce(m.remind, false), 'recap', coalesce(m.recap, false))
  from (select 1) x left join mm_members m on m.pool = upper(trim(p_pool)) and m.user_id = auth.uid();
$$;
create or replace function public.mm_recap_set(p_pool text, p_on boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  update mm_members set recap = coalesce(p_on, false) where pool = upper(trim(p_pool)) and user_id = auth.uid();
  if not found then return jsonb_build_object('error', 'Join this pool first.'); end if;
  return jsonb_build_object('ok', true, 'recap', coalesce(p_on, false));
end $$;
revoke all on function public.mm_recap_set(text, boolean) from public, anon;
grant execute on function public.mm_recap_set(text, boolean) to authenticated;

create or replace function public.mm_recap_boards(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare m record; out jsonb := '[]'::jsonb; b jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  for m in select mb.pool, mb.user_id, u.email, mm_name(mb.pool, mb.user_id) as nm, p.name as pool_name, p.kind
      from mm_members mb join mm_pools p on p.id = mb.pool join auth.users u on u.id = mb.user_id
      where mb.recap and u.email is not null and p.kind <> 'squares' loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', m.user_id, 'role', 'authenticated')::text, true);
    b := mm_board(m.pool);
    if b ? 'ok' then
      out := out || jsonb_build_array(jsonb_build_object('pool', m.pool, 'user', m.user_id, 'email', m.email, 'name', m.nm, 'pool_name', m.pool_name, 'kind', m.kind, 'board', b));
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('boards', out);
end $$;
create or replace function public.mm_recap_claim(p_token text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  with ins as (
    insert into mm_recapped (pool, user_id, wk)
      select r ->> 'pool', (r ->> 'user')::uuid, (r ->> 'wk')::date from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    on conflict do nothing returning pool, user_id, wk)
  select coalesce(jsonb_agg(jsonb_build_object('pool', pool, 'user', user_id, 'wk', wk)), '[]'::jsonb) into out from ins;
  delete from mm_recapped where sent_at < now() - interval '200 days';
  return jsonb_build_object('claimed', out);
end $$;
revoke all on function public.mm_recap_boards(text), public.mm_recap_claim(text, jsonb) from public, authenticated;
grant execute on function public.mm_recap_boards(text), public.mm_recap_claim(text, jsonb) to anon;

-- ---------- NBA tracking handoff (2026-11-22) ----------
-- stats.nba.com refuses cloud servers, so tools/nba_tracking_pull.js runs in a browser on nba.com and drops the
-- result here; nba-tracking.yml reads it back (tools/nba_tracking.py) and publishes nba/data/tracking.json.
create table if not exists public.nba_tracking_drop (
  id bigserial primary key,
  created timestamptz not null default now(),
  season text not null,
  players int not null,
  body jsonb not null
);
alter table public.nba_tracking_drop enable row level security;
revoke all on public.nba_tracking_drop from anon, authenticated;
create or replace function public.nba_tracking_put(body jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare n int; sz int;
begin
  sz := octet_length(body::text);
  if sz > 400000 then raise exception 'too large'; end if;
  if jsonb_typeof(body) <> 'object' or coalesce(body->>'season', '') !~ '^\d{4}-\d{2}$' then raise exception 'bad season'; end if;
  if jsonb_typeof(body->'cols') <> 'array' or jsonb_array_length(body->'cols') > 80 then raise exception 'bad cols'; end if;
  if jsonb_typeof(body->'p') <> 'object' then raise exception 'bad players'; end if;
  select count(*) into n from jsonb_object_keys(body->'p');
  if n < 150 or n > 900 then raise exception 'unexpected player count %', n; end if;
  if exists (select 1 from nba_tracking_drop where created > now() - interval '10 minutes') then raise exception 'too soon'; end if;
  insert into nba_tracking_drop (season, players, body) values (body->>'season', n, body);
  delete from nba_tracking_drop where id not in (select id from nba_tracking_drop order by id desc limit 5);
  return json_build_object('ok', true, 'players', n, 'bytes', sz);
end $$;
create or replace function public.nba_tracking_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('created', created, 'body', body) from nba_tracking_drop order by id desc limit 1
$$;
revoke all on function public.nba_tracking_put(jsonb) from public;
revoke all on function public.nba_tracking_get() from public;
grant execute on function public.nba_tracking_put(jsonb) to anon, authenticated;
grant execute on function public.nba_tracking_get() to anon, authenticated;
