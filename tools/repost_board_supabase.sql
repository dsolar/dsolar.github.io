-- Repost Board (repost-board/): daily over/unders on how many tweets a friend reposts, by topic. A day's count is the
-- number of tweets posted that New York day that he reposted. Each day has six markets with a half-number line; picks
-- lock at noon New York time that day and settle once the day's count is marked final. One point per correct pick.
-- The board is private: you need the site account and the join code (rb_config.code) once. Counts and lines are
-- written from outside (a daily pull); nothing here reads X.
-- Run in the Supabase SQL editor (it's safe to run again).

create table if not exists public.rb_days (
  day date primary key,
  total int not null default 0, celtics int not null default 0, habs int not null default 0, sports int not null default 0,
  uspol int not null default 0, mideast int not null default 0, other int not null default 0,
  final boolean not null default false,
  as_of timestamptz not null default now());
create table if not exists public.rb_lines (
  day date primary key,
  total numeric not null, celtics numeric not null, habs numeric not null, sports numeric not null,
  uspol numeric not null, mideast numeric not null);
create table if not exists public.rb_picks (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  market text not null check (market in ('total', 'celtics', 'habs', 'sports', 'uspol', 'mideast')),
  side text not null check (side in ('o', 'u')),
  picked_at timestamptz not null default now(),
  primary key (user_id, day, market));
create table if not exists public.rb_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now());
create table if not exists public.rb_config (
  id int primary key check (id = 1),
  code text not null,
  sources jsonb not null default '[]'::jsonb, sources_window text, sources_uniq int);
-- no policies: everything goes through the functions below
alter table public.rb_days enable row level security;
alter table public.rb_lines enable row level security;
alter table public.rb_picks enable row level security;
alter table public.rb_members enable row level security;
alter table public.rb_config enable row level security;

-- when a day's slate locks: noon in New York that day
create or replace function public.rb_lock_at(p_day date) returns timestamptz
language sql immutable as $$ select (p_day + time '12:00') at time zone 'America/New_York'; $$;

create or replace function public.rb_name(u uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(trim((select name from fk_profiles where user_id = u)), ''), (select username from fk_usernames where user_id = u), 'Player');
$$;

-- post lines for today and tomorrow if they aren't up yet: the median of the last 14 final days, set to a half number.
-- A posted line never changes, because people have already picked against it.
create or replace function public.rb_post_lines() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare today date := (now() at time zone 'America/New_York')::date; d date; n int := 0;
begin
  foreach d in array array[today, today + 1] loop
    insert into rb_lines (day, total, celtics, habs, sports, uspol, mideast)
    select d, floor(percentile_cont(0.5) within group (order by total)) + 0.5, floor(percentile_cont(0.5) within group (order by celtics)) + 0.5,
      floor(percentile_cont(0.5) within group (order by habs)) + 0.5, floor(percentile_cont(0.5) within group (order by sports)) + 0.5,
      floor(percentile_cont(0.5) within group (order by uspol)) + 0.5, floor(percentile_cont(0.5) within group (order by mideast)) + 0.5
    from (select * from rb_days where final and day < d order by day desc limit 14) x
    having count(*) >= 5
    on conflict (day) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'posted', n);
end $$;

-- the whole board for a member: counts, lines, your picks, the standings and the most reposted accounts
create or replace function public.rb_board() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'America/New_York')::date;
begin
  if uid is null then return jsonb_build_object('error', 'signin'); end if;
  if not exists (select 1 from rb_members where user_id = uid) then return jsonb_build_object('error', 'join'); end if;
  return jsonb_build_object('ok', true, 'today', today, 'now', now(),
    'locks', jsonb_build_object(today::text, rb_lock_at(today), (today + 1)::text, rb_lock_at(today + 1)),
    'days', (select coalesce(jsonb_object_agg(d.day, to_jsonb(d) - 'day'), '{}'::jsonb) from rb_days d where d.day > today - 46),
    'lines', (select coalesce(jsonb_object_agg(l.day, to_jsonb(l) - 'day'), '{}'::jsonb) from rb_lines l where l.day > today - 46),
    'picks', (select coalesce(jsonb_object_agg(x.day, x.m), '{}'::jsonb) from (select day, jsonb_object_agg(market, side) m from rb_picks where user_id = uid group by day) x),
    'standings', (select coalesce(jsonb_agg(to_jsonb(s) order by s.w - s.l desc, s.w desc, s.name), '[]'::jsonb) from (
      select r.user_id = uid as me, rb_name(r.user_id) as name,
        count(*) filter (where r.win) as w, count(*) filter (where r.win = false) as l,
        count(*) filter (where r.win is null and r.day >= today - 1) as live,
        coalesce((array_agg(case when r.win then 1 else 0 end order by r.day desc, r.market desc) filter (where r.win is not null))[1:30], '{}') as recent
      from (select p.user_id, p.day, p.market,
          case when d.final and l.day is not null then (p.side = 'o') = ((to_jsonb(d) ->> p.market)::numeric > (to_jsonb(l) ->> p.market)::numeric) end as win
        from rb_picks p left join rb_days d on d.day = p.day left join rb_lines l on l.day = p.day) r
      group by r.user_id) s),
    'sources', (select jsonb_build_object('top', sources, 'window', sources_window, 'uniq', sources_uniq) from rb_config where id = 1));
end $$;

-- make, change or clear (p_side null) a pick, until the slate locks
create or replace function public.rb_pick(p_day date, p_market text, p_side text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to pick.'); end if;
  if not exists (select 1 from rb_members where user_id = uid) then return jsonb_build_object('error', 'Join the board first.'); end if;
  if p_market not in ('total', 'celtics', 'habs', 'sports', 'uspol', 'mideast') or (p_side is not null and p_side not in ('o', 'u')) then return jsonb_build_object('error', 'That isn''t a pick.'); end if;
  if not exists (select 1 from rb_lines where day = p_day) then return jsonb_build_object('error', 'No lines are posted for that day.'); end if;
  if now() >= rb_lock_at(p_day) then return jsonb_build_object('error', 'That slate is locked.'); end if;
  if p_side is null then delete from rb_picks where user_id = uid and day = p_day and market = p_market;
  else insert into rb_picks (user_id, day, market, side) values (uid, p_day, p_market, p_side)
    on conflict (user_id, day, market) do update set side = excluded.side, picked_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rb_join(p_code text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if exists (select 1 from rb_members where user_id = uid) then return jsonb_build_object('ok', true); end if;
  if not exists (select 1 from rb_config where id = 1 and code = upper(trim(coalesce(p_code, '')))) then return jsonb_build_object('error', 'That code isn''t right.'); end if;
  insert into rb_members (user_id) values (uid) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.rb_name(uuid), public.rb_post_lines() from public, anon, authenticated;
revoke all on function public.rb_board(), public.rb_pick(date, text, text), public.rb_join(text) from public;
grant execute on function public.rb_board() to anon, authenticated;
grant execute on function public.rb_pick(date, text, text), public.rb_join(text) to authenticated;
