-- Draft Lab's wins pool (fantasy/pools/wins/): friends draft real NBA or NFL teams in a snake, and the most combined
-- wins from draft day forward takes it. No lineups, no waivers: one draft, then the standings keep score.
--
--   The owner makes a pool (a six-letter code to share) and says how many teams each entry drafts. Entries join until
--   the draft starts. Starting it shuffles the order and saves each team's record that day (the baseline the site's
--   standings file had: celtics/live.json for the NBA, nfl/data/games.json for the NFL), so only wins after it count.
--   The draft is a snake with no clock: whoever is up picks, on their own time. The owner can pick for someone who
--   texted a pick in, and can undo the last pick. When every entry has its teams the draft is done.
--   The page works out the table from the site's standings: each team's wins now, less its wins at the baseline.
--
-- Over/under (mode 'ou', added 2026-11-25): each pick is a team and a side against its win-total line, so a team can
--   go twice, once over and once under. The line is the site's projection of the team's final wins the day the draft
--   starts (nba/data/proj.json, nfl/data/fpi.json), rounded to the half, saved with the baseline. The page scores it:
--   over is final wins less the line, under the reverse, using today's projection until the season's games are in.
--
-- Its own tables and functions (wn_*; wp_ is the Win Probability game): nothing here changes the other pools. Codes
-- don't collide with theirs.
-- Run in the Supabase SQL editor (it's safe to run again).

create table if not exists public.wn_pools (
  id text primary key, name text not null,
  sport text not null check (sport in ('nba', 'nfl')),
  per int not null default 4 check (per between 1 and 16),
  owner uuid references auth.users (id) on delete set null,
  draft jsonb,                       -- null until it starts: { order: [user ids], started, teams: [codes], base: { CODE: { w, l } }, season }
  done_at timestamptz,
  created_at timestamptz not null default now());
create table if not exists public.wn_members (
  pool text not null references public.wn_pools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text, joined_at timestamptz not null default now(),
  primary key (pool, user_id));
create index if not exists wn_members_user on public.wn_members (user_id);
create table if not exists public.wn_picks (
  pool text not null references public.wn_pools (id) on delete cascade,
  n int not null,                    -- the overall pick, from 1
  user_id uuid not null, team text not null,
  picked_at timestamptz not null default now(), by uuid,
  primary key (pool, n), unique (pool, team),
  foreign key (pool, user_id) references public.wn_members (pool, user_id) on delete cascade);
alter table public.wn_pools add column if not exists mode text not null default 'wins';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wn_pools_mode_check') then
    alter table public.wn_pools add constraint wn_pools_mode_check check (mode in ('wins', 'ou'));
  end if;
end $$;
-- a pick's side: '' in a wins pool, 'o' or 'u' in an over/under pool (where a team can go once each way)
alter table public.wn_picks add column if not exists side text not null default '';
alter table public.wn_picks drop constraint if exists wn_picks_pool_team_key;
create unique index if not exists wn_picks_pool_team_side on public.wn_picks (pool, team, side);
alter table public.wn_pools enable row level security;
alter table public.wn_members enable row level security;
alter table public.wn_picks enable row level security;
revoke all on public.wn_pools, public.wn_members, public.wn_picks from anon, authenticated;

-- an entry's name: the one it gave the pool, or the account's display name
create or replace function public.wn_name(p_pool text, u uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(trim((select name from wn_members where pool = p_pool and user_id = u)), ''), pk_name(u));
$$;

-- whose pick it is: a snake over the saved order (pick n from 1; m entries)
create or replace function public.wn_turn(p_order jsonb, p_n int) returns uuid
language sql immutable as $$
  select (p_order ->> (case when ((p_n - 1) / jsonb_array_length(p_order)) % 2 = 0
    then (p_n - 1) % jsonb_array_length(p_order)
    else jsonb_array_length(p_order) - 1 - (p_n - 1) % jsonb_array_length(p_order) end))::uuid;
$$;

drop function if exists public.wn_create(text, text, int, text);
create or replace function public.wn_create(p_name text, p_sport text, p_per int default 4, p_entry text default null, p_mode text default 'wins') returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40);
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a pool.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  if p_sport not in ('nba', 'nfl') then return jsonb_build_object('error', 'Pick the NBA or the NFL.'); end if;
  if coalesce(p_mode, 'wins') not in ('wins', 'ou') then return jsonb_build_object('error', 'Pick most wins or over/under.'); end if;
  if coalesce(p_per, 0) not between 1 and 16 then return jsonb_build_object('error', 'Each entry drafts 1 to 16 teams.'); end if;
  if (select count(*) from wn_pools where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of pools. Delete one first.'); end if;
  loop
    code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=0Oo1IiLl', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from wn_pools where id = code)
      and not exists (select 1 from mm_pools where id = code) and not exists (select 1 from pk_groups where id = code);
  end loop;
  insert into wn_pools (id, name, sport, per, owner, mode) values (code, nm, p_sport, p_per, uid, coalesce(p_mode, 'wins'));
  insert into wn_members (pool, user_id, name) values (code, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''));
  return jsonb_build_object('ok', true, 'id', code, 'name', nm, 'sport', p_sport);
end $$;

-- join (or rename your entry) until the draft starts
create or replace function public.wn_join(p_code text, p_entry text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools; mine boolean;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to join a pool.'); end if;
  select * into p from wn_pools where id = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('error', 'No pool has that code. Check it and try again.'); end if;
  mine := exists (select 1 from wn_members where pool = p.id and user_id = uid);
  if p.draft is not null and not mine then return jsonb_build_object('error', 'This pool''s draft has started, so it''s closed to new entries.'); end if;
  if not mine and (select count(*) from wn_members where pool = p.id) >= 32 then return jsonb_build_object('error', 'That pool is full.'); end if;
  insert into wn_members (pool, user_id, name) values (p.id, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''))
  on conflict (pool, user_id) do update set name = coalesce(excluded.name, wn_members.name);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'sport', p.sport);
end $$;

-- leave before the draft starts (the owner deletes the pool instead)
create or replace function public.wn_leave(p_code text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into p from wn_pools where id = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('error', 'No pool has that code.'); end if;
  if p.owner = uid then return jsonb_build_object('error', 'You own this pool. Delete it instead.'); end if;
  if p.draft is not null then return jsonb_build_object('error', 'The draft has started, so entries are set.'); end if;
  delete from wn_members where pool = p.id and user_id = uid;
  return jsonb_build_object('ok', true);
end $$;

-- the owner: rename the pool or change how many teams each entry drafts (before the draft), or remove an entry
create or replace function public.wn_update(p_pool text, p_name text default null, p_per int default null, p_remove uuid default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools; nm text := left(trim(coalesce(p_name, '')), 40);
begin
  select * into p from wn_pools where id = p_pool;
  if not found or uid is null or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can change it.'); end if;
  if nm <> '' then update wn_pools set name = nm where id = p.id; end if;
  if p_per is not null or p_remove is not null then
    if p.draft is not null then return jsonb_build_object('error', 'The draft has started, so that''s set.'); end if;
    if p_per is not null then
      if p_per not between 1 and 16 then return jsonb_build_object('error', 'Each entry drafts 1 to 16 teams.'); end if;
      update wn_pools set per = p_per where id = p.id;
    end if;
    if p_remove is not null and p_remove <> uid then delete from wn_members where pool = p.id and user_id = p_remove; end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.wn_delete(p_pool text, p_confirm text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools;
begin
  select * into p from wn_pools where id = p_pool;
  if not found or uid is null or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can delete it.'); end if;
  if upper(trim(coalesce(p_confirm, ''))) <> p.id then return jsonb_build_object('error', 'Type the pool''s code to delete it.'); end if;
  delete from wn_pools where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

-- the owner starts the draft: the league's teams and each one's record right now (from the site's standings file),
-- and a shuffled order. Every entry needs its teams, so entries times teams each can't pass the league's size.
drop function if exists public.wn_start(text, text[], jsonb, text);
create or replace function public.wn_start(p_pool text, p_teams text[], p_base jsonb, p_season text default null, p_lines jsonb default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools; m int; ord jsonb; t text; rec jsonb; clean jsonb := '{}'::jsonb; want int; room int; lines jsonb := '{}'::jsonb; ln text;
begin
  select * into p from wn_pools where id = p_pool for update;
  if not found or uid is null or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can start the draft.'); end if;
  if p.draft is not null then return jsonb_build_object('error', 'The draft already started.'); end if;
  select count(*) into m from wn_members where pool = p.id;
  if m < 2 then return jsonb_build_object('error', 'A pool needs at least two entries. Send the invite first.'); end if;
  want := case p.sport when 'nba' then 30 else 32 end;
  if p_teams is null or cardinality(p_teams) <> want or (select count(distinct x) from unnest(p_teams) x) <> want then
    return jsonb_build_object('error', 'The standings didn''t load. Refresh and try again.');
  end if;
  room := case when p.mode = 'ou' then want * 2 else want end;
  if m * p.per > room then return jsonb_build_object('error', format('%s entries drafting %s each is more than the %s there are. Lower the teams each.', m, p.per, room)); end if;
  foreach t in array p_teams loop
    if t !~ '^[A-Z]{2,4}$' then return jsonb_build_object('error', 'The standings didn''t load. Refresh and try again.'); end if;
    rec := coalesce(p_base -> t, '{}'::jsonb);
    clean := clean || jsonb_build_object(t, jsonb_build_object(
      'w', case when rec ->> 'w' ~ '^[0-9]{1,3}$' then least(200, (rec ->> 'w')::int) else 0 end,
      'l', case when rec ->> 'l' ~ '^[0-9]{1,3}$' then least(200, (rec ->> 'l')::int) else 0 end));
    if p.mode = 'ou' then
      -- every team needs a line: a number of wins to the half
      ln := p_lines ->> t;
      if ln is null or ln !~ '^[0-9]{1,3}(\.[05])?$' then return jsonb_build_object('error', 'The win-total lines didn''t load. Refresh and try again.'); end if;
      lines := lines || jsonb_build_object(t, ln::numeric);
    end if;
  end loop;
  select jsonb_agg(user_id order by random()) into ord from wn_members where pool = p.id;
  update wn_pools set draft = jsonb_build_object('order', ord, 'started', now(), 'teams', to_jsonb(p_teams), 'base', clean,
    'season', left(coalesce(p_season, ''), 12)) || case when p.mode = 'ou' then jsonb_build_object('lines', lines) else '{}'::jsonb end where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

-- a pick: the entry that's up takes a team nobody has. The owner can make it for them (p_for).
drop function if exists public.wn_pick(text, text, uuid);
create or replace function public.wn_pick(p_pool text, p_team text, p_for uuid default null, p_side text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools; m int; n int; up uuid; sd text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to draft.'); end if;
  select * into p from wn_pools where id = p_pool for update;
  if not found then return jsonb_build_object('error', 'No pool has that code.'); end if;
  if p.draft is null then return jsonb_build_object('error', 'The draft hasn''t started.'); end if;
  if p.done_at is not null then return jsonb_build_object('error', 'The draft is over.'); end if;
  m := jsonb_array_length(p.draft -> 'order');
  select count(*) + 1 into n from wn_picks where pool = p.id;
  up := wn_turn(p.draft -> 'order', n);
  if up <> uid and not (p.owner = uid and p_for is not distinct from up) then
    return jsonb_build_object('error', format('It''s %s''s pick.', wn_name(p.id, up)));
  end if;
  if not (p.draft -> 'teams') ? p_team then return jsonb_build_object('error', 'That team isn''t in this pool.'); end if;
  sd := case when p.mode = 'ou' then coalesce(p_side, '') else '' end;
  if p.mode = 'ou' and sd not in ('o', 'u') then return jsonb_build_object('error', 'Pick the over or the under.'); end if;
  if exists (select 1 from wn_picks where pool = p.id and team = p_team and side = sd) then
    return jsonb_build_object('error', case when p.mode = 'ou' then 'That side of that team is taken.' else 'That team is taken.' end);
  end if;
  insert into wn_picks (pool, n, user_id, team, side, by) values (p.id, n, up, p_team, sd, case when up <> uid then uid end);
  if n >= m * p.per then update wn_pools set done_at = now() where id = p.id; end if;
  return jsonb_build_object('ok', true, 'n', n, 'done', n >= m * p.per);
end $$;

-- the owner takes back the last pick
create or replace function public.wn_undo(p_pool text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools;
begin
  select * into p from wn_pools where id = p_pool for update;
  if not found or uid is null or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can undo a pick.'); end if;
  delete from wn_picks where pool = p.id and n = (select max(n) from wn_picks where pool = p.id);
  if not found then return jsonb_build_object('error', 'Nothing to undo.'); end if;
  update wn_pools set done_at = null where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

-- a pool's board: its settings, entries and picks. Anyone with the code can look.
create or replace function public.wn_board(p_pool text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p wn_pools;
begin
  select * into p from wn_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found then return jsonb_build_object('error', 'No pool has that code.'); end if;
  return jsonb_build_object('ok', true,
    'pool', jsonb_build_object('id', p.id, 'name', p.name, 'sport', p.sport, 'mode', p.mode, 'per', p.per, 'mine', p.owner is not distinct from uid and uid is not null,
      'draft', p.draft, 'done', p.done_at, 'created', p.created_at),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', wn_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at)
      from wn_members m where m.pool = p.id), '[]'::jsonb),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('n', k.n, 'user', k.user_id, 'team', k.team, 'side', k.side, 'at', k.picked_at, 'by', k.by is not null) order by k.n)
      from wn_picks k where k.pool = p.id), '[]'::jsonb));
end $$;

create or replace function public.wn_mine() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sport', p.sport, 'mode', p.mode, 'per', p.per,
      'members', (select count(*) from wn_members x where x.pool = p.id),
      'picks', (select count(*) from wn_picks k where k.pool = p.id),
      'started', p.draft is not null, 'done', p.done_at is not null,
      'up', case when p.draft is not null and p.done_at is null
        then wn_turn(p.draft -> 'order', (select count(*)::int + 1 from wn_picks k where k.pool = p.id)) = auth.uid() else false end)
    order by p.created_at desc), '[]'::jsonb)
  from wn_pools p join wn_members m on m.pool = p.id and m.user_id = auth.uid();
$$;

revoke all on function public.wn_name(text, uuid), public.wn_turn(jsonb, int) from public, anon, authenticated;
grant execute on function public.wn_board(text) to anon, authenticated;
grant execute on function public.wn_create(text, text, int, text, text), public.wn_join(text, text), public.wn_leave(text),
  public.wn_update(text, text, int, uuid), public.wn_delete(text, text), public.wn_start(text, text[], jsonb, text, jsonb),
  public.wn_pick(text, text, uuid, text), public.wn_undo(text), public.wn_mine() to authenticated;
