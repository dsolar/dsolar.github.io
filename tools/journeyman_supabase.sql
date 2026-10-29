-- Daily group board for Journeyman (davidsolar.dev/journeyman/). Same setup and lockdown as Guess the Pick's
-- 5-point board (tools/guess_the_pick_supabase.sql): the browser can only post one score per device per day
-- and read the board, through the two functions below. Already set up; safe to run again.
create table if not exists public.jm_daily (
  id bigint generated always as identity primary key,
  day date not null,
  sport text not null check (sport in ('nba', 'nfl', 'mlb')),
  device text not null check (char_length(device) between 8 and 64),
  player text not null check (char_length(player) between 1 and 24),
  squares text not null check (squares ~ '^[0-5]{10}$'),
  score smallint not null check (score between 0 and 50),
  created_at timestamptz not null default now(),
  unique (day, sport, device)
);
create index if not exists jm_daily_sport_day on public.jm_daily (sport, day);
alter table public.jm_daily enable row level security;
revoke all on public.jm_daily from anon, authenticated;

create or replace function public.jm_post(p_day date, p_sport text, p_device text, p_player text, p_squares text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total smallint := 0;
  i int;
begin
  if p_day < (now() at time zone 'America/New_York')::date - 1 or p_day > (now() at time zone 'America/New_York')::date + 1 then
    raise exception 'not today''s daily';
  end if;
  if p_squares !~ '^[0-5]{10}$' then
    raise exception 'bad squares';
  end if;
  for i in 1..10 loop
    total := total + substr(p_squares, i, 1)::smallint;
  end loop;
  insert into public.jm_daily (day, sport, device, player, squares, score)
  values (p_day, p_sport, p_device, left(btrim(p_player), 24), p_squares, total)
  on conflict (day, sport, device) do update set player = excluded.player;
end;
$$;

create or replace function public.jm_board(p_sport text, p_from date, p_to date)
returns table (day date, player text, squares text, score smallint, device text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.day, d.player, d.squares, d.score, left(md5(d.device), 10), d.created_at
  from public.jm_daily d
  where d.sport = p_sport and d.day between p_from and p_to and p_to - p_from <= 14
  order by d.created_at;
$$;

revoke all on function public.jm_post(date, text, text, text, text) from public;
revoke all on function public.jm_board(text, date, date) from public;
grant execute on function public.jm_post(date, text, text, text, text) to anon, authenticated;
grant execute on function public.jm_board(text, date, date) to anon, authenticated;
