-- Draft Lab side bets: one manager offers another a bet, the other takes it or turns it down, and the league page
-- settles it from the results. Three kinds:
--   week     outscore the other team in a week (or beat him, in a category league where they play each other); open
--            until that week locks (fk_pick_lock: the week's first kickoff)
--   season   finish ahead of him in the final standings
--   custom   anything the two agree on, in words; the commissioner marks the winner
-- Money moves outside Draft Lab, like dues; the league page keeps the running tally. A bet is per team, so a
-- co-manager can offer and answer for his. The other team hears about an offer the way he hears about a trade offer.
--   fk_bet_offer(league, to team, kind, week, terms, amount)    fk_bet_answer(league, bet, accept)
--   fk_bet_cancel(league, bet)    fk_bet_settle(league, bet, winner team)  (commissioner)    fk_bets(league)
-- Run after fantasykit_supabase.sql and fantasykit_picks.sql (fk_pick_lock).

create table if not exists public.fk_bets (
  id bigserial primary key,
  league text not null references public.fk_leagues(id) on delete cascade,
  season text not null,
  by_team int not null,
  to_team int not null,
  kind text not null check (kind in ('week', 'season', 'custom')),
  week int,
  terms text,
  amt int not null default 0 check (amt between 0 and 1000),
  status text not null default 'offered' check (status in ('offered', 'on', 'declined', 'cancelled')),
  winner int,
  at timestamptz not null default now(),
  answered timestamptz
);
create index if not exists fk_bets_league on public.fk_bets (league, season);
alter table public.fk_bets enable row level security;   -- no policies: only the functions below touch it
revoke all on public.fk_bets from anon, authenticated;

create or replace function public.fk_bets(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'by', b.by_team, 'to', b.to_team, 'kind', b.kind, 'week', b.week, 'terms', b.terms,
      'amt', b.amt, 'status', b.status, 'winner', b.winner, 'at', (extract(epoch from b.at) * 1000)::bigint) order by b.id desc), '[]'::jsonb)
  from fk_bets b where b.league = p_id and b.season = coalesce((select league->>'season' from fk_leagues where id = p_id), '')
    and b.status in ('offered', 'on');
$$;

create or replace function public.fk_bet_offer(p_id text, p_to int, p_kind text, p_week int, p_terms text, p_amt int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; lg jsonb; cur int; lk bigint; t text; tgt record;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into s from fk_seats where league = p_id and user_id = uid;
  if not found then return jsonb_build_object('error', 'Only managers in this league can make a bet.'); end if;
  select league into lg from fk_leagues where id = p_id;
  if lg is null then return jsonb_build_object('error', 'The season hasn''t started yet.'); end if;
  if p_to is null or p_to = s.team then return jsonb_build_object('error', 'Pick another team.'); end if;
  select * into tgt from fk_seats where league = p_id and team = p_to and user_id is not null limit 1;
  if not found then return jsonb_build_object('error', 'That team has no manager to take the bet.'); end if;
  if p_kind not in ('week', 'season', 'custom') then return jsonb_build_object('error', 'Pick what the bet is on.'); end if;
  if p_amt is null or p_amt < 0 or p_amt > 1000 then return jsonb_build_object('error', 'Bets run from $0 (bragging rights) to $1,000.'); end if;
  cur := coalesce((lg->>'week')::int, 1);
  if p_kind = 'week' then
    if p_week is null or p_week < cur or p_week > cur + 3 then return jsonb_build_object('error', 'Pick this week or one of the next three.'); end if;
    lk := fk_pick_lock(lg, p_week);
    if lk is not null and lk <= (extract(epoch from now()) * 1000)::bigint then return jsonb_build_object('error', 'That week''s games have started.'); end if;
  end if;
  t := nullif(left(btrim(regexp_replace(coalesce(p_terms, ''), '[\x01-\x1f\x7f]+', ' ', 'g')), 160), '');
  if p_kind = 'custom' and (t is null or length(t) < 5) then return jsonb_build_object('error', 'Say what the bet is.'); end if;
  if (select count(*) from fk_bets where league = p_id and by_team = s.team and status = 'offered') >= 10 then
    return jsonb_build_object('error', 'You have 10 offers waiting. Give them a chance to answer first.');
  end if;
  insert into fk_bets (league, season, by_team, to_team, kind, week, terms, amt)
    values (p_id, coalesce(lg->>'season', ''), s.team, p_to, p_kind, case when p_kind = 'week' then p_week end, case when p_kind = 'custom' then t end, p_amt);
  -- tell the other team, the way a trade offer does
  if exists (select 1 from fk_seats where league = p_id and team = p_to and notify) then
    insert into fk_outbox (league, team, kind, subject, body, data)
      values (p_id, p_to, 'bet', left(coalesce(s.manager, 'A manager') || ' offered you a bet', 120),
        left(coalesce(s.manager, 'A manager') || ' bet you ' || case when p_amt > 0 then '$' || p_amt else 'bragging rights' end || ': ' ||
          case p_kind when 'week' then 'outscore you in week ' || p_week when 'season' then 'finish ahead of you this season' else t end ||
          '. Take it or turn it down on the league page.', 2000), jsonb_build_object('url', 'https://davidsolar.dev/fantasy/league/?id=' || p_id || '#league/bets'));
  end if;
  return jsonb_build_object('ok', true, 'list', fk_bets(p_id));
end $$;

create or replace function public.fk_bet_answer(p_id text, p_bet bigint, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; b fk_bets; lk bigint;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into s from fk_seats where league = p_id and user_id = uid;
  select * into b from fk_bets where id = p_bet and league = p_id;
  if b.id is null or s.team is distinct from b.to_team then return jsonb_build_object('error', 'That bet isn''t yours to answer.'); end if;
  if b.status <> 'offered' then return jsonb_build_object('error', 'That bet was already answered or taken back.'); end if;
  if p_accept and b.kind = 'week' then
    lk := fk_pick_lock((select league from fk_leagues where id = p_id), b.week);
    if lk is not null and lk <= (extract(epoch from now()) * 1000)::bigint then return jsonb_build_object('error', 'That week''s games have started, so it''s too late to take it.'); end if;
  end if;
  update fk_bets set status = case when p_accept then 'on' else 'declined' end, answered = now() where id = p_bet;
  return jsonb_build_object('ok', true, 'list', fk_bets(p_id));
end $$;

create or replace function public.fk_bet_cancel(p_id text, p_bet bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; b fk_bets;
begin
  select * into s from fk_seats where league = p_id and user_id = uid;
  select * into b from fk_bets where id = p_bet and league = p_id;
  if uid is null or b.id is null or s.team is distinct from b.by_team then return jsonb_build_object('error', 'That bet isn''t yours to take back.'); end if;
  if b.status <> 'offered' then return jsonb_build_object('error', 'It''s already been answered.'); end if;
  update fk_bets set status = 'cancelled', answered = now() where id = p_bet;
  return jsonb_build_object('ok', true, 'list', fk_bets(p_id));
end $$;

-- the commissioner marks who won a custom bet (null takes the call back)
create or replace function public.fk_bet_settle(p_id text, p_bet bigint, p_winner int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b fk_bets;
begin
  if uid is null or not exists (select 1 from fk_leagues where id = p_id and commish = uid) then return jsonb_build_object('error', 'Only the commissioner settles a bet.'); end if;
  select * into b from fk_bets where id = p_bet and league = p_id;
  if b.id is null or b.kind <> 'custom' or b.status <> 'on' then return jsonb_build_object('error', 'Only a live custom bet is settled by hand.'); end if;
  if p_winner is not null and p_winner not in (b.by_team, b.to_team) then return jsonb_build_object('error', 'The winner is one of the two teams.'); end if;
  update fk_bets set winner = p_winner where id = p_bet;
  return jsonb_build_object('ok', true, 'list', fk_bets(p_id));
end $$;

revoke all on function public.fk_bet_offer(text, int, text, int, text, int), public.fk_bet_answer(text, bigint, boolean),
  public.fk_bet_cancel(text, bigint), public.fk_bet_settle(text, bigint, int) from public, anon;
grant execute on function public.fk_bet_offer(text, int, text, int, text, int), public.fk_bet_answer(text, bigint, boolean),
  public.fk_bet_cancel(text, bigint), public.fk_bet_settle(text, bigint, int) to authenticated;
grant execute on function public.fk_bets(text) to anon, authenticated;
