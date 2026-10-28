-- Daily leaderboard for Guess the Pick (davidsolar.dev/guess-the-pick/).
-- One-time setup: Supabase dashboard > SQL Editor > New query > paste this whole file > Run. Safe to run again.
-- Same lockdown as Make the Call's crowd votes: the browser never touches the table directly. It can only
-- post one score per device per day and read the board, through the two functions below.
--   squares   ten digits, one per pick, each 0 to 3 points ("3320130233"); the score is their sum
--   device    a random id the game keeps on each phone or laptop, so a refresh can't post twice
--   player    the name someone typed; posting again from the same device that day only renames the row

create table if not exists public.gtp_daily (
  id bigint generated always as identity primary key,
  day date not null,
  sport text not null check (sport in ('nba', 'nfl')),
  device text not null check (char_length(device) between 8 and 64),
  player text not null check (char_length(player) between 1 and 24),
  squares text not null check (squares ~ '^[0-3]{10}$'),
  score smallint not null check (score between 0 and 30),
  created_at timestamptz not null default now(),
  unique (day, sport, device)
);
create index if not exists gtp_daily_sport_day on public.gtp_daily (sport, day);

alter table public.gtp_daily enable row level security;
revoke all on public.gtp_daily from anon, authenticated;

create or replace function public.gtp_post(p_day date, p_sport text, p_device text, p_player text, p_squares text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total smallint := 0;
  i int;
begin
  -- Only today's daily (with a day of slack either side for time zones).
  if p_day < (now() at time zone 'America/New_York')::date - 1 or p_day > (now() at time zone 'America/New_York')::date + 1 then
    raise exception 'not today''s daily';
  end if;
  if p_squares !~ '^[0-3]{10}$' then
    raise exception 'bad squares';
  end if;
  for i in 1..10 loop
    total := total + substr(p_squares, i, 1)::smallint;
  end loop;
  insert into public.gtp_daily (day, sport, device, player, squares, score)
  values (p_day, p_sport, p_device, left(btrim(p_player), 24), p_squares, total)
  on conflict (day, sport, device) do update set player = excluded.player;
end;
$$;

-- Every score for one sport between two days (at most two weeks), oldest first.
create or replace function public.gtp_board(p_sport text, p_from date, p_to date)
returns table (day date, player text, squares text, score smallint, device text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.day, d.player, d.squares, d.score, left(md5(d.device), 10), d.created_at
  from public.gtp_daily d
  where d.sport = p_sport and d.day between p_from and p_to and p_to - p_from <= 14
  order by d.created_at;
$$;

revoke all on function public.gtp_post(date, text, text, text, text) from public;
revoke all on function public.gtp_board(text, date, date) from public;
grant execute on function public.gtp_post(date, text, text, text, text) to anon, authenticated;
grant execute on function public.gtp_board(text, date, date) to anon, authenticated;
