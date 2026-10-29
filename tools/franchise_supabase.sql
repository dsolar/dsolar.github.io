-- GM leaderboard for The 31st Franchise (davidsolar.dev/31st-franchise/).
-- One-time setup: Supabase dashboard > SQL Editor > New query > paste this whole file > Run. Safe to run again.
-- (Already set up on Oct 29, 2026.)
-- Same lockdown as the other boards: the browser never touches the table. It can post a finished season and
-- read the board, through the two functions below.
--   device   a random id the game keeps on each phone or laptop (shared with Guess the Pick as gtp-device)
--   player   the name someone typed; posting again from the same device renames the row
-- One row per device: its best season (most wins, then franchise value), plus every title and season played.

create table if not exists public.franchise_board (
  device text primary key check (char_length(device) between 8 and 64),
  player text not null check (char_length(player) between 1 and 24),
  team text not null check (team in ('SEA', 'LV')),
  w smallint not null check (w between 0 and 82),
  l smallint not null check (l between 0 and 82),
  result text not null default '' check (char_length(result) <= 60),
  value numeric(6, 2) not null default 0,
  grade text not null default '' check (char_length(grade) <= 4),
  core text[] not null default '{}',
  firsts smallint not null default 0,
  titles int not null default 0,
  seasons int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.franchise_board enable row level security;
revoke all on public.franchise_board from anon, authenticated;

create or replace function public.franchise_post(p_device text, p_player text, p_team text, p_w int, p_l int,
  p_result text, p_value numeric, p_grade text, p_core text[], p_firsts int, p_champ boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_w < 0 or p_l < 0 or p_w + p_l <> 82 then raise exception 'bad record'; end if;
  if p_team not in ('SEA', 'LV') then raise exception 'bad team'; end if;
  insert into public.franchise_board as b (device, player, team, w, l, result, value, grade, core, firsts, titles, seasons)
  values (p_device, left(btrim(p_player), 24), p_team, p_w, p_l, left(coalesce(p_result, ''), 60), least(greatest(coalesce(p_value, 0), 0), 9999),
          left(coalesce(p_grade, ''), 4), coalesce(p_core[1:3], '{}'), least(greatest(coalesce(p_firsts, 0), 0), 30), case when p_champ then 1 else 0 end, 1)
  on conflict (device) do update set
    player = excluded.player,
    titles = b.titles + excluded.titles,
    seasons = b.seasons + 1,
    updated_at = now(),
    -- the best season wins the row: more wins, or as many wins and a more valuable franchise
    team = case when excluded.w > b.w or (excluded.w = b.w and excluded.value > b.value) then excluded.team else b.team end,
    l = case when excluded.w > b.w or (excluded.w = b.w and excluded.value > b.value) then excluded.l else b.l end,
    result = case when excluded.w > b.w or (excluded.w = b.w and excluded.value > b.value) then excluded.result else b.result end,
    value = case when excluded.w > b.w or (excluded.w = b.w and excluded.value > b.value) then excluded.value else b.value end,
    grade = case when excluded.w > b.w or (excluded.w = b.w and excluded.value > b.value) then excluded.grade else b.grade end,
    core = case when excluded.w > b.w or (excluded.w = b.w and excluded.value > b.value) then excluded.core else b.core end,
    firsts = case when excluded.w > b.w or (excluded.w = b.w and excluded.value > b.value) then excluded.firsts else b.firsts end,
    w = greatest(b.w, excluded.w);
end;
$$;

-- Renames this device's row (the board's "change name" box), without posting a season
create or replace function public.franchise_rename(p_device text, p_player text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.franchise_board set player = left(btrim(p_player), 24) where device = p_device and char_length(btrim(p_player)) between 1 and 24;
$$;

-- The top 50, best record first. "me" marks the asking device's own row, so the page can show "You"
-- without any device ids leaving the database.
drop function if exists public.franchise_top();
create or replace function public.franchise_top(p_device text default null)
returns table (player text, team text, w smallint, l smallint, result text, value numeric, grade text, core text[], firsts smallint,
               titles int, seasons int, me boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.player, b.team, b.w, b.l, b.result, b.value, b.grade, b.core, b.firsts, b.titles, b.seasons, b.device = p_device, b.updated_at
  from public.franchise_board b
  order by b.w desc, b.titles desc, b.value desc, b.updated_at
  limit 50;
$$;

revoke all on function public.franchise_post(text, text, text, int, int, text, numeric, text, text[], int, boolean) from public;
revoke all on function public.franchise_rename(text, text) from public;
revoke all on function public.franchise_top(text) from public;
grant execute on function public.franchise_post(text, text, text, int, int, text, numeric, text, text[], int, boolean) to anon, authenticated;
grant execute on function public.franchise_rename(text, text) to anon, authenticated;
grant execute on function public.franchise_top(text) to anon, authenticated;
