-- Draft Lab league pick'em: each week every manager picks the winner of each matchup in his league, and a season
-- leaderboard keeps score. One set of picks a team a week (a co-manager's are his team's), changeable until the week
-- locks: the week's first kickoff (the league's saved kick times, league.kick) in a league on real games. The current
-- week and the next one are open; past weeks aren't. Other teams' picks stay hidden until the week locks.
--   fk_pick(league, week, picks)   save this week's picks: { "3-7": 7, ... } (the pair's team ids low-high: the winner)
--   fk_picks(league)               this season's picks: [{ week, team, picks (null while hidden), at, me }]
-- Run after fantasykit_supabase.sql.

create table if not exists public.fk_picks (
  league text not null references public.fk_leagues(id) on delete cascade,
  season text not null,
  week int not null,
  team int not null,
  user_id uuid not null,
  picks jsonb not null,
  at timestamptz not null default now(),
  primary key (league, season, week, team)
);
alter table public.fk_picks enable row level security;   -- no policies: only the functions below touch it
revoke all on public.fk_picks from anon, authenticated;

-- when a week locks (epoch ms), from the saved league: its first kickoff once the league has the week's kick times,
-- else null (not locked yet, as far as the server knows); a week before the current one is long locked (0)
create or replace function public.fk_pick_lock(lg jsonb, p_week int) returns bigint
language sql immutable set search_path = public as $$
  select case
    when p_week < coalesce((lg->>'week')::int, 1) then 0
    when (lg->'kick'->>'week')::int = p_week then (select min(v::bigint) from jsonb_each_text(coalesce(lg->'kick'->'teams', '{}'::jsonb)) t(k, v) where v ~ '^\d+$')
    else null end;
$$;

create or replace function public.fk_pick(p_id text, p_week int, p_picks jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; lg jsonb; cur int; lk bigint; ss text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into s from fk_seats where league = p_id and user_id = uid;
  if not found then return jsonb_build_object('error', 'Only managers in this league can make picks.'); end if;
  select league into lg from fk_leagues where id = p_id;
  if lg is null then return jsonb_build_object('error', 'The season hasn''t started yet.'); end if;
  cur := coalesce((lg->>'week')::int, 1);
  ss := coalesce(lg->>'season', '');
  if p_week is null or p_week < cur or p_week > cur + 1 then return jsonb_build_object('error', 'Picks are open for this week and next.'); end if;
  lk := fk_pick_lock(lg, p_week);
  if lk is not null and lk <= (extract(epoch from now()) * 1000)::bigint then return jsonb_build_object('error', 'This week''s games have started, so picks are locked.'); end if;
  if jsonb_typeof(p_picks) <> 'object' or (select count(*) from jsonb_object_keys(p_picks)) > 20
     or exists (select 1 from jsonb_each(p_picks) e where e.key !~ '^\d{1,2}-\d{1,2}$' or jsonb_typeof(e.value) <> 'number') then
    return jsonb_build_object('error', 'Those picks don''t look right. Reload the page and try again.');
  end if;
  if (select count(*) from jsonb_object_keys(p_picks)) = 0 then
    delete from fk_picks where league = p_id and season = ss and week = p_week and team = s.team;
  else
    insert into fk_picks (league, season, week, team, user_id, picks) values (p_id, ss, p_week, s.team, uid, p_picks)
      on conflict (league, season, week, team) do update set picks = excluded.picks, user_id = excluded.user_id, at = now();
  end if;
  return jsonb_build_object('ok', true, 'list', fk_picks(p_id));
end $$;

create or replace function public.fk_picks(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  with lg as (select league from fk_leagues where id = p_id),
  mine as (select team from fk_seats where league = p_id and user_id = auth.uid())
  select coalesce(jsonb_agg(jsonb_build_object('week', p.week, 'team', p.team, 'at', (extract(epoch from p.at) * 1000)::bigint,
      'me', p.team in (select team from mine),
      'picks', case when p.team in (select team from mine) or coalesce(fk_pick_lock((select league from lg), p.week), (extract(epoch from now()) * 1000)::bigint + 1) <= (extract(epoch from now()) * 1000)::bigint then p.picks else null end)
    order by p.week, p.team), '[]'::jsonb)
  from fk_picks p where p.league = p_id and p.season = coalesce((select league->>'season' from lg), '');
$$;

revoke all on function public.fk_pick(text, int, jsonb) from public, anon;
grant execute on function public.fk_pick(text, int, jsonb) to authenticated;
grant execute on function public.fk_picks(text) to anon, authenticated;
revoke all on function public.fk_pick_lock(jsonb, int) from public, anon, authenticated;
