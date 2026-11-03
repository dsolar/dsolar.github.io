-- Big Board: Top 10 Challenge (draft/, the Challenge tab). Everyone posts a top-10 mock under a name and a PIN.
-- Picks are public, each with the time it was set, so an early call keeps its bonus and a copied one doesn't.
-- Picks lock at the start of each draft (bb_drafts.lock_at, checked here on the server).
-- The page talks to these functions only; the tables themselves are closed to the public key.
-- Safe to run again.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.bb_drafts (
  league text primary key check (league in ('nba', 'nfl')),
  year int not null,
  lock_at timestamptz not null,
  note text
);

create table if not exists public.bb_entries (
  id bigint generated always as identity primary key,
  league text not null references public.bb_drafts (league),
  name text not null,
  name_key text not null,
  pin_hash text not null,
  picks jsonb not null default '[]'::jsonb,   -- [{ "slot": 1, "pid": "player-id", "n": "Player Name", "at": "2026-11-03T21:00:00Z" }]
  fails int not null default 0,
  wait_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league, name_key)
);

-- Open to anyone with the link, so new names are rate-limited: three a day from one network (a salted hash of
-- the address, never the address itself) and forty in ten minutes per league overall.
alter table public.bb_entries add column if not exists ip_hash text;

alter table public.bb_drafts enable row level security;
alter table public.bb_entries enable row level security;
revoke all on public.bb_drafts, public.bb_entries from anon, authenticated;

-- First round of the 2027 NFL draft: Apr 29, 2027, Washington. The NBA hasn't set its 2027 date; late June is
-- the norm, so this locks the evening of June 24 until the league announces it (update the row then).
insert into public.bb_drafts (league, year, lock_at, note) values
  ('nfl', 2027, '2027-04-29 20:00:00-04', 'Round 1, Apr 29, 2027'),
  ('nba', 2027, '2027-06-24 20:00:00-04', 'Date not announced yet; late June')
on conflict (league) do nothing;

-- Plain text only: no control characters or markup or spreadsheet formula starters.
create or replace function public.bb_clean(s text, n int) returns text
language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(s, ''), '[[:cntrl:]<>=+@]', '', 'g'), '\s+', ' ', 'g')), n);
$$;

-- Returns null when the PIN matches (or the entry is new), else the message to show. Five misses wait 15 minutes.
create or replace function public.bb_pin_ok(p_id bigint, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r public.bb_entries;
begin
  select * into r from public.bb_entries where id = p_id for update;
  if r.wait_until is not null and r.wait_until > now() then return 'Too many wrong PINs. Try again in 15 minutes.'; end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then
    update public.bb_entries set fails = r.fails + 1,
      wait_until = case when r.fails + 1 >= 5 then now() + interval '15 minutes' end where id = p_id;
    return 'That name is taken and the PIN doesn''t match.';
  end if;
  if r.fails > 0 then update public.bb_entries set fails = 0, wait_until = null where id = p_id; end if;
  return null;
end $$;

-- Save a mock. A pick that didn't change keeps the time it was first set; a new or changed one is stamped now.
create or replace function public.bb_save(p_league text, p_name text, p_pin text, p_picks jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d public.bb_drafts;
  e public.bb_entries;
  nm text := public.bb_clean(p_name, 24);
  msg text;
  item jsonb;
  old jsonb;
  res jsonb := '[]'::jsonb;
  slots int[] := '{}';
  pids text[] := '{}';
  s int;
  pid text;
  ip text;
begin
  select * into d from public.bb_drafts where league = p_league;
  if not found then return jsonb_build_object('error', 'No such draft.'); end if;
  if now() >= d.lock_at then return jsonb_build_object('error', 'Picks are locked: the draft has started.'); end if;
  if length(nm) < 2 then return jsonb_build_object('error', 'Pick a name, 2 to 24 characters.'); end if;
  if p_pin is null or p_pin !~ '^\d{4,8}$' then return jsonb_build_object('error', 'The PIN is 4 to 8 digits.'); end if;
  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) > 10 then return jsonb_build_object('error', 'Up to 10 picks.'); end if;

  select * into e from public.bb_entries where league = p_league and name_key = lower(nm);
  if found then
    msg := public.bb_pin_ok(e.id, p_pin);
    if msg is not null then return jsonb_build_object('error', msg); end if;
  end if;

  for item in select * from jsonb_array_elements(p_picks) loop
    s := (item ->> 'slot')::int;
    pid := item ->> 'pid';
    if s is null or s < 1 or s > 10 or s = any (slots) then return jsonb_build_object('error', 'Each slot once, 1 to 10.'); end if;
    if pid is null or pid !~ '^[a-z0-9-]{1,64}$' or pid = any (pids) then return jsonb_build_object('error', 'Each player once.'); end if;
    slots := slots || s; pids := pids || pid;
    old := null;
    if e.id is not null then
      select x into old from jsonb_array_elements(e.picks) x where (x ->> 'slot')::int = s and x ->> 'pid' = pid limit 1;
    end if;
    res := res || jsonb_build_object('slot', s, 'pid', pid, 'n', public.bb_clean(item ->> 'n', 48),
      'at', coalesce(old ->> 'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end loop;

  if e.id is null then
    ip := encode(digest(coalesce(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), '') || 'bb-challenge', 'sha256'), 'hex');
    if (select count(*) from public.bb_entries where ip_hash = ip and league = p_league and created_at > now() - interval '1 day') >= 3 then
      return jsonb_build_object('error', 'That''s three new names from here today. Try again tomorrow, or update one you have.');
    end if;
    if (select count(*) from public.bb_entries where league = p_league and created_at > now() - interval '10 minutes') >= 40 then
      return jsonb_build_object('error', 'Lots of new entries right now. Try again in a few minutes.');
    end if;
    insert into public.bb_entries (league, name, name_key, pin_hash, picks, ip_hash)
      values (p_league, nm, lower(nm), crypt(p_pin, gen_salt('bf', 8)), res, ip);
  else
    update public.bb_entries set picks = res, name = nm, updated_at = now() where id = e.id;
  end if;
  return jsonb_build_object('ok', true, 'name', nm, 'picks', res);
end $$;

-- Load your own mock back (needs the PIN, so nobody can check whether a name's PIN is right without it).
create or replace function public.bb_mine(p_league text, p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e public.bb_entries; msg text;
begin
  select * into e from public.bb_entries where league = p_league and name_key = lower(public.bb_clean(p_name, 24));
  if not found then return jsonb_build_object('error', 'No mock under that name yet.'); end if;
  msg := public.bb_pin_ok(e.id, p_pin);
  if msg is not null then return jsonb_build_object('error', msg); end if;
  return jsonb_build_object('ok', true, 'name', e.name, 'picks', e.picks);
end $$;

-- Everyone's mock for a league, plus when picks lock.
create or replace function public.bb_board(p_league text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lock_at', (select lock_at from public.bb_drafts where league = p_league),
    'note', (select note from public.bb_drafts where league = p_league),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'picks', picks, 'updated', updated_at) order by updated_at)
      from public.bb_entries where league = p_league), '[]'::jsonb));
$$;

revoke all on function public.bb_clean(text, int) from public, anon, authenticated;
revoke all on function public.bb_pin_ok(bigint, text) from public, anon, authenticated;
revoke all on function public.bb_save(text, text, text, jsonb) from public;
revoke all on function public.bb_mine(text, text, text) from public;
revoke all on function public.bb_board(text) from public;
grant execute on function public.bb_save(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.bb_mine(text, text, text) to anon, authenticated;
grant execute on function public.bb_board(text) to anon, authenticated;

-- To take down an entry (a junk name, say), in the SQL editor:
--   delete from public.bb_entries where league = 'nfl' and name_key = lower('The Name');
