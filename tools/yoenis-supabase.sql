-- Keeper declarations and the draft-date vote for Don't Forget to Wipe Yoenis (davidsolar.dev/yoenis/).
-- Live in the Supabase project "dsolar's Project" (baxrczyufqbzrogftmyn) as migration yoenis_keepers_and_vote.
--
-- The page calls three functions with the project's public (anon/publishable) key:
--   yoenis_view(p_y)                                              -> {keepers, vote: {dates, marks}, lock}
--   yoenis_save_keepers(p_y, p_team, p_pin, p_players)            -> the same view, or {"error": "..."}
--   yoenis_vote(p_y, p_team, p_pin, p_day, p_yes)                 -> the same view, or {"error": "..."}
-- and the keeper sheet mirrors the data with IMPORTDATA on the yoenis-sheet edge function, which calls
--   yoenis_sheet_rows(p_y, p_tab)                                 -> rows for the "2027" or "2027 Draft Vote" tab
--
-- The tables are closed to the public (row level security with no policies); only these functions touch them.
-- A team's first save sets its PIN (4 to 8 digits, stored as a bcrypt hash). Five wrong PINs in a row lock that
-- team out for 15 minutes. To reset a forgotten PIN:   delete from yoenis_pins where team = '<team>';
-- To lock keepers:   insert into yoenis_settings (y, lock_at) values (2027, '2027-03-07 23:59-05')
--                    on conflict (y) do update set lock_at = excluded.lock_at;
-- Ballot dates live in yoenis_ballot; add or remove rows to change them.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.yoenis_teams (
  y int not null, team text not null, col int not null,          -- col: the team's column in the keeper sheet, 1-16
  primary key (y, team)
);
create table if not exists public.yoenis_keepers (
  y int not null, team text not null,
  players jsonb not null default '[]'::jsonb,                     -- [["Aaron Judge", 1, 3, false], ...]: player, round, keeper year, corrected
  updated_at timestamptz not null default now(),
  primary key (y, team)
);
create table if not exists public.yoenis_ballot (y int not null, day date not null, primary key (y, day));
create table if not exists public.yoenis_votes (
  y int not null, team text not null, day date not null, yes boolean not null, updated_at timestamptz not null default now(),
  primary key (y, team, day)
);
create table if not exists public.yoenis_pins (team text primary key, pin_hash text not null, fails int not null default 0, wait_until timestamptz);
create table if not exists public.yoenis_settings (y int primary key, lock_at timestamptz);

alter table public.yoenis_teams enable row level security;
alter table public.yoenis_keepers enable row level security;
alter table public.yoenis_ballot enable row level security;
alter table public.yoenis_votes enable row level security;
alter table public.yoenis_pins enable row level security;
alter table public.yoenis_settings enable row level security;
revoke all on public.yoenis_teams, public.yoenis_keepers, public.yoenis_ballot, public.yoenis_votes, public.yoenis_pins, public.yoenis_settings from anon, authenticated;

-- ---------- Reading ----------
create or replace function public.yoenis_view(p_y int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'keepers', coalesce((select jsonb_object_agg(team, players) from yoenis_keepers where y = p_y and jsonb_array_length(players) > 0), '{}'::jsonb),
    'vote', jsonb_build_object(
      'dates', coalesce((select jsonb_agg(jsonb_build_object('id', to_char(day, 'YYYY-MM-DD'), 'label', to_char(day, 'FMDay, FMMonth FMDD')) order by day)
                         from yoenis_ballot where y = p_y), '[]'::jsonb),
      'marks', coalesce((select jsonb_object_agg(team, m) from (
                           select team, jsonb_object_agg(to_char(day, 'YYYY-MM-DD'), case when yes then 1 else 0 end) m
                           from yoenis_votes where y = p_y and day in (select day from yoenis_ballot where y = p_y) group by team) t), '{}'::jsonb)),
    'lock', coalesce((select to_char(lock_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from yoenis_settings where y = p_y), ''));
$$;

-- ---------- PINs ----------
-- Returns null when the PIN is good (setting it on a team's first save), else the message to show.
-- Not callable from the page: only the functions below use it.
create or replace function public.yoenis_pin_ok(p_team text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r yoenis_pins;
begin
  if p_pin is null or p_pin !~ '^\d{4,8}$' then return 'The PIN is 4 to 8 digits.'; end if;
  select * into r from yoenis_pins where team = p_team for update;
  if not found then
    insert into yoenis_pins (team, pin_hash) values (p_team, crypt(p_pin, gen_salt('bf', 8)));
    return null;
  end if;
  if r.wait_until is not null and r.wait_until > now() then return 'Too many wrong PINs. Try again in 15 minutes.'; end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then
    update yoenis_pins set fails = r.fails + 1, wait_until = case when r.fails + 1 >= 5 then now() + interval '15 minutes' end where team = p_team;
    return 'That''s not this team''s PIN. Ask the commissioner to reset it.';
  end if;
  if r.fails > 0 then update yoenis_pins set fails = 0, wait_until = null where team = p_team; end if;
  return null;
end $$;

-- Plain text only: no control characters or spreadsheet formula starters
create or replace function public.yoenis_clean(s text, n int) returns text
language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(s, ''), '[[:cntrl:]<>=+@]', '', 'g'), '\s+', ' ', 'g')), n);
$$;

-- ---------- Writing ----------
create or replace function public.yoenis_save_keepers(p_y int, p_team text, p_pin text, p_players jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; k jsonb; nm text; bad text; lk timestamptz;
begin
  if not exists (select 1 from yoenis_teams where y = p_y and team = p_team) then return jsonb_build_object('error', 'Which team?'); end if;
  select lock_at into lk from yoenis_settings where y = p_y;
  if lk is not null and now() > lk then return jsonb_build_object('error', 'Keepers are locked.'); end if;
  if jsonb_typeof(p_players) is distinct from 'array' then return jsonb_build_object('error', 'Send a list of keepers.'); end if;
  for k in select value from jsonb_array_elements(p_players) loop
    nm := yoenis_clean(k->>0, 60);
    if nm = '' then continue; end if;
    out := out || jsonb_build_array(jsonb_build_array(nm,
      greatest(1, least(25, coalesce((k->>1)::numeric::int, 15))),
      greatest(1, least(3, coalesce((k->>2)::numeric::int, 1))), false));
  end loop;
  if jsonb_array_length(out) > 5 then return jsonb_build_object('error', 'Five keepers at most.'); end if;
  bad := yoenis_pin_ok(p_team, p_pin);
  if bad is not null then return jsonb_build_object('error', bad); end if;
  insert into yoenis_keepers (y, team, players, updated_at) values (p_y, p_team, out, now())
    on conflict (y, team) do update set players = excluded.players, updated_at = now();
  return yoenis_view(p_y);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('error', 'Rounds and keeper years are whole numbers.');
end $$;

create or replace function public.yoenis_vote(p_y int, p_team text, p_pin text, p_day text, p_yes boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bad text; d date;
begin
  if not exists (select 1 from yoenis_teams where y = p_y and team = p_team) then return jsonb_build_object('error', 'Which team?'); end if;
  if p_day !~ '^\d{4}-\d\d-\d\d$' then return jsonb_build_object('error', 'That date isn''t on the ballot.'); end if;
  d := p_day::date;
  if not exists (select 1 from yoenis_ballot where y = p_y and day = d) then return jsonb_build_object('error', 'That date isn''t on the ballot.'); end if;
  bad := yoenis_pin_ok(p_team, p_pin);
  if bad is not null then return jsonb_build_object('error', bad); end if;
  insert into yoenis_votes (y, team, day, yes, updated_at) values (p_y, p_team, d, coalesce(p_yes, false), now())
    on conflict (y, team, day) do update set yes = excluded.yes, updated_at = now();
  return yoenis_view(p_y);
exception when invalid_datetime_format or datetime_field_overflow then
  return jsonb_build_object('error', 'That date isn''t on the ballot.');
end $$;

-- ---------- The keeper sheet's mirror ----------
-- "keepers": the sheet's layout, two blocks of eight team columns with up to five "Player (round/year)" under each.
-- "vote": Team, then one column per ballot date; a Totals row; then a row per team with 1 (yes), 0 (no) or blank.
create or replace function public.yoenis_sheet_rows(p_y int, p_tab text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rows jsonb := '[]'::jsonb; blk int; i int; t record; line jsonb; cell text; ks jsonb;
begin
  if p_tab = 'vote' then
    rows := rows || jsonb_build_array(jsonb_build_array('Team') || coalesce((select jsonb_agg(to_char(day, 'Dy, Mon FMDD') order by day) from yoenis_ballot where y = p_y), '[]'::jsonb));
    rows := rows || jsonb_build_array(jsonb_build_array('Totals') || coalesce((select jsonb_agg((select count(*) from yoenis_votes v where v.y = p_y and v.day = b.day and v.yes)::int order by b.day) from yoenis_ballot b where b.y = p_y), '[]'::jsonb));
    for t in select team from yoenis_teams where y = p_y order by col loop
      rows := rows || jsonb_build_array(jsonb_build_array(t.team) || coalesce((select jsonb_agg(coalesce(to_jsonb(case when v.yes then 1 when v.yes is not null then 0 end), '""'::jsonb) order by b.day)
                                                                                 from yoenis_ballot b left join yoenis_votes v on v.y = b.y and v.day = b.day and v.team = t.team where b.y = p_y), '[]'::jsonb));
    end loop;
    return rows;
  end if;
  for blk in 0..1 loop
    if blk = 1 then rows := rows || jsonb_build_array('[]'::jsonb); end if;
    rows := rows || jsonb_build_array(coalesce((select jsonb_agg(team order by col) from yoenis_teams where y = p_y and col between blk * 8 + 1 and blk * 8 + 8), '[]'::jsonb));
    for i in 0..4 loop
      line := '[]'::jsonb;
      for t in select team from yoenis_teams where y = p_y and col between blk * 8 + 1 and blk * 8 + 8 order by col loop
        select players into ks from yoenis_keepers where y = p_y and team = t.team;
        cell := case when ks is not null and jsonb_array_length(ks) > i
                     then (ks->i->>0) || ' (' || (ks->i->>1) || '/' || (ks->i->>2) || ')' || case when (ks->i->>3)::boolean then '*' else '' end
                     else '' end;
        line := line || to_jsonb(cell);
      end loop;
      rows := rows || jsonb_build_array(line);
    end loop;
  end loop;
  return rows;
end $$;

revoke execute on function public.yoenis_view(int), public.yoenis_pin_ok(text, text), public.yoenis_clean(text, int),
  public.yoenis_save_keepers(int, text, text, jsonb), public.yoenis_vote(int, text, text, text, boolean), public.yoenis_sheet_rows(int, text) from public;
revoke execute on function public.yoenis_pin_ok(text, text), public.yoenis_clean(text, int) from anon, authenticated;
grant execute on function public.yoenis_view(int), public.yoenis_save_keepers(int, text, text, jsonb), public.yoenis_vote(int, text, text, text, boolean),
  public.yoenis_sheet_rows(int, text) to anon, authenticated;

-- ---------- 2027 ----------
insert into public.yoenis_teams (y, team, col) values
  (2027, 'Ippei''s Book Club', 1), (2027, 'Welcome 2 da fam nick madrigal', 2), (2027, 'Chaz Jizzem', 3), (2027, 'Dane Dombrowski', 4),
  (2027, 'Slider Inside', 5), (2027, 'LoveGaretRchrdsThatsMy_Problem', 6), (2027, 'Corbin My Man', 7), (2027, 'Joe Buck Yourself', 8),
  (2027, 'Kitty Autumn', 9), (2027, 'Mendoza Line Misfitzzz', 10), (2027, 'Newton South Loins', 11), (2027, 'Padilla Flotilla', 12),
  (2027, 'Robbers', 13), (2027, 'Bulba', 14), (2027, 'SimDOS', 15), (2027, 'Dylan Never Ceases to Amaze Me', 16)
on conflict (y, team) do update set col = excluded.col;
-- the 10 days before Opening Day (March 24, 2027)
insert into public.yoenis_ballot (y, day) select 2027, d::date from generate_series('2027-03-14'::date, '2027-03-23'::date, interval '1 day') d
on conflict do nothing;
