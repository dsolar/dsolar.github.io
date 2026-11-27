-- NFL pick'em reminders: a player who turns them on gets an email about three hours before a game he hasn't picked
-- kicks off, listing that slate's open games and how many more are left this week. Two at most a week (the first
-- slate he's behind on, usually Thursday or Sunday's early games, then one more), and none before the lines are set.
-- The server clock (fk-clock, every five minutes) calls pk_remind_due, which claims each one as it hands it over, so
-- a slate is emailed once. Run after pickem_supabase.sql and fantasykit_more.sql (fk_token_ok).

create table if not exists public.pk_remind (
  user_id uuid primary key references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.pk_remind enable row level security;
revoke all on public.pk_remind from anon, authenticated;

create table if not exists public.pk_reminded (
  user_id uuid not null references auth.users (id) on delete cascade,
  season int not null, stype int not null, week int not null,
  slot timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, slot)
);
alter table public.pk_reminded enable row level security;
revoke all on public.pk_reminded from anon, authenticated;

create or replace function public.pk_remind_get() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('remind', exists (select 1 from pk_remind where user_id = auth.uid()));
$$;

create or replace function public.pk_remind_set(p_on boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if coalesce(p_on, false) then insert into pk_remind (user_id) values (auth.uid()) on conflict do nothing;
  else delete from pk_remind where user_id = auth.uid(); end if;
  return jsonb_build_object('ok', true, 'remind', coalesce(p_on, false));
end $$;

-- who's due now: the earliest game each opted-in player hasn't picked kicks off in 10 minutes to 3 hours, the line is
-- set, and he hasn't had this slate's reminder or two this week already. Claimed here, so each goes out once.
create or replace function public.pk_remind_due(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare out jsonb := '[]'::jsonb; r record; games jsonb; rest int;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  for r in
    select u.id as uid, u.email, pk_name(u.id) as name, x.kickoff as slot, x.season, x.stype, x.week
    from pk_remind m join auth.users u on u.id = m.user_id
    cross join lateral (
      select g.kickoff, g.season, g.stype, g.week from pk_games g
      where g.kickoff > now() and g.spread is not null and not g.final
        and not exists (select 1 from pk_picks p where p.user_id = m.user_id and p.game_id = g.game_id)
      order by g.kickoff limit 1) x
    where u.email is not null
      and x.kickoff > now() + interval '10 minutes' and x.kickoff <= now() + interval '3 hours'
  loop
    if (select count(*) from pk_reminded d where d.user_id = r.uid and d.season = r.season and d.stype = r.stype and d.week = r.week) >= 2 then continue; end if;
    insert into pk_reminded (user_id, season, stype, week, slot) values (r.uid, r.season, r.stype, r.week, r.slot) on conflict do nothing;
    if not found then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object('away', g.away, 'home', g.home, 'spread', g.spread) order by g.game_id), '[]'::jsonb) into games
      from pk_games g where g.kickoff = r.slot and g.spread is not null
        and not exists (select 1 from pk_picks p where p.user_id = r.uid and p.game_id = g.game_id);
    select count(*) into rest from pk_games g where g.season = r.season and g.stype = r.stype and g.week = r.week and g.kickoff > r.slot
      and not exists (select 1 from pk_picks p where p.user_id = r.uid and p.game_id = g.game_id);
    out := out || jsonb_build_array(jsonb_build_object('email', r.email, 'name', r.name, 'slot', (extract(epoch from r.slot) * 1000)::bigint,
      'week', r.week, 'stype', r.stype, 'games', games, 'rest', rest));
  end loop;
  delete from pk_reminded where sent_at < now() - interval '400 days';
  return jsonb_build_object('due', out);
end $$;

revoke all on function public.pk_remind_get(), public.pk_remind_set(boolean) from public, anon;
grant execute on function public.pk_remind_get(), public.pk_remind_set(boolean) to authenticated;
revoke all on function public.pk_remind_due(text) from public, anon, authenticated;
grant execute on function public.pk_remind_due(text) to anon;   -- the clock calls it with the anon key and its token
