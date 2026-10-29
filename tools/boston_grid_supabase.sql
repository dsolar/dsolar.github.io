-- Daily board for Boston Grid (davidsolar.dev/boston-grid/).
-- One-time setup: Supabase dashboard > SQL Editor > New query > paste this whole file > Run. Safe to run again.
-- (Already set up on Oct 29, 2026.)
-- Same lockdown as the other boards: the browser never touches the table. It can post one grid per device per
-- day and read a day's board, through the two functions below.
--   squares  nine digits, one per square in reading order, 1 for a right answer and 0 for an empty one
--   deep     deep-cut points, 10 to 100 for each right answer (more for a lesser-known player)
--   device   a random id each phone or laptop keeps (shared with the other games as gtp-device)

create table if not exists public.bg_daily (
  id bigint generated always as identity primary key,
  day date not null,
  sport text not null check (sport in ('nba', 'nfl', 'mlb')),
  device text not null check (char_length(device) between 8 and 64),
  player text not null check (char_length(player) between 1 and 24),
  squares text not null check (squares ~ '^[01]{9}$'),
  score smallint not null check (score between 0 and 9),
  deep smallint not null check (deep between 0 and 900),
  created_at timestamptz not null default now(),
  unique (day, sport, device)
);
create index if not exists bg_daily_sport_day on public.bg_daily (sport, day);
alter table public.bg_daily enable row level security;
revoke all on public.bg_daily from anon, authenticated;

create or replace function public.bg_post(p_day date, p_sport text, p_device text, p_player text, p_squares text, p_deep int)
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
    raise exception 'not today''s grid';
  end if;
  if p_squares !~ '^[01]{9}$' then raise exception 'bad squares'; end if;
  for i in 1..9 loop total := total + substr(p_squares, i, 1)::smallint; end loop;
  if p_deep < 10 * total or p_deep > 100 * total then raise exception 'bad points'; end if;
  insert into public.bg_daily (day, sport, device, player, squares, score, deep)
  values (p_day, p_sport, p_device, left(btrim(p_player), 24), p_squares, total, p_deep)
  on conflict (day, sport, device) do update set player = excluded.player;
end;
$$;

-- One day's board for one league, best grid first. "me" marks the asking device's own row.
create or replace function public.bg_board(p_sport text, p_day date, p_device text default null)
returns table (player text, squares text, score smallint, deep smallint, me boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.player, d.squares, d.score, d.deep, d.device = p_device, d.created_at
  from public.bg_daily d
  where d.sport = p_sport and d.day = p_day
  order by d.score desc, d.deep desc, d.created_at
  limit 100;
$$;

revoke all on function public.bg_post(date, text, text, text, text, int) from public;
revoke all on function public.bg_board(text, date, text) from public;
grant execute on function public.bg_post(date, text, text, text, text, int) to anon, authenticated;
grant execute on function public.bg_board(text, date, text) to anon, authenticated;
