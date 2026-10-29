-- Daily board for Scouting Report (davidsolar.dev/scouting-report/).
-- One-time setup: Supabase dashboard > SQL Editor > New query > paste this whole file > Run. Safe to run again.
-- (Already set up on Oct 29, 2026.)
-- Same lockdown as the other boards: the browser can post one daily per device per day and read a day's board.
--   squares  five digits, one per report, each 0 to 5 points; the score is their sum
--   device   a random id each phone or laptop keeps (shared with the other games as gtp-device)

create table if not exists public.sr_daily (
  id bigint generated always as identity primary key,
  day date not null,
  device text not null check (char_length(device) between 8 and 64),
  player text not null check (char_length(player) between 1 and 24),
  squares text not null check (squares ~ '^[0-5]{5}$'),
  score smallint not null check (score between 0 and 25),
  created_at timestamptz not null default now(),
  unique (day, device)
);
create index if not exists sr_daily_day on public.sr_daily (day);
alter table public.sr_daily enable row level security;
revoke all on public.sr_daily from anon, authenticated;

create or replace function public.sr_post(p_day date, p_device text, p_player text, p_squares text)
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
  if p_squares !~ '^[0-5]{5}$' then raise exception 'bad squares'; end if;
  for i in 1..5 loop total := total + substr(p_squares, i, 1)::smallint; end loop;
  insert into public.sr_daily (day, device, player, squares, score)
  values (p_day, p_device, left(btrim(p_player), 24), p_squares, total)
  on conflict (day, device) do update set player = excluded.player;
end;
$$;

-- One day's board, best score first. "me" marks the asking device's own row.
create or replace function public.sr_board(p_day date, p_device text default null)
returns table (player text, squares text, score smallint, me boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.player, d.squares, d.score, d.device = p_device, d.created_at
  from public.sr_daily d
  where d.day = p_day
  order by d.score desc, d.created_at
  limit 100;
$$;

revoke all on function public.sr_post(date, text, text, text) from public;
revoke all on function public.sr_board(date, text) from public;
grant execute on function public.sr_post(date, text, text, text) to anon, authenticated;
grant execute on function public.sr_board(date, text) to anon, authenticated;
