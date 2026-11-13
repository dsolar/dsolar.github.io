-- Shared leagues for the Fantasy Kit (davidsolar.dev/fantasy-kit/play.html).
-- Lives in the Supabase project "dsolar's Project" (baxrczyufqbzrogftmyn) as migration fantasykit_leagues.
--
-- How it works, like Hard Cap: a league is one draft document and, once the draft is done, one league document,
-- with a version number. The page runs the rules (fantasy-kit/draft.js and league.js) and saves the new documents
-- with the version it started from; if someone saved in between, the save is refused and the page takes the newer
-- documents. The server's jobs are the ones the page can't be trusted with: who is signed in (Supabase Auth, an
-- emailed sign-in link), who owns which team, the invite code, the save order, and the email outbox.
--
-- The page calls these with the project's publishable key and the signed-in user's access token:
--   fk_create(p_name, p_sport, p_manager, p_draft)        -> {id, invite, version}   the creator is commissioner and team 0
--   fk_view(p_id, p_since)                                 -> {version, now, me, commish, seats, invite?, draft?, league?}
--                                                             documents only when newer than p_since; anyone with the id can view
--   fk_join(p_id, p_invite, p_team, p_manager)             -> {ok, version} or {error}   claims an open team
--   fk_save(p_id, p_version, p_draft, p_league, p_events)  -> {ok, version} or {error, version, draft, league}
--                                                             p_events: [{team, kind, subject, body}] queue emails
--   fk_mine()                                              -> [{id, name, sport, team, commish, phase, updated}]
--   fk_notify(p_id, p_on)                                  -> {ok}       email alerts on or off for your seat
--   fk_leave(p_id, p_team)                                 -> {ok}       give up your team (or the commissioner frees one)
-- The server clock (supabase/functions/fk-clock, called by pg_cron every five minutes) keeps leagues moving with no
-- page open and sends the email outbox. It passes a token whose sha256 is in fk_config:
--   fk_clock_list(p_token), fk_clock_save(p_token, p_id, p_version, p_draft, p_league, p_events)
--   fk_outbox_take(p_token, p_limit), fk_outbox_done(p_token, p_ids, p_errors)
--
-- Every table is closed to the public (row level security with no policies); only these functions touch them.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.fk_leagues (
  id text primary key,
  name text not null,
  sport text not null check (sport in ('nba', 'nfl', 'mlb')),
  commish uuid not null,
  invite text not null,
  draft jsonb not null,
  league jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.fk_seats (
  league text not null references public.fk_leagues(id) on delete cascade,
  team int not null,
  user_id uuid not null,
  email text,
  manager text not null,
  notify boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (league, team),
  unique (league, user_id)
);
create table if not exists public.fk_outbox (
  id bigserial primary key,
  league text not null references public.fk_leagues(id) on delete cascade,
  team int not null,
  kind text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  tries int not null default 0,
  error text
);
create index if not exists fk_outbox_unsent on public.fk_outbox (created_at) where sent_at is null;
create table if not exists public.fk_config (name text primary key, value text not null);

alter table public.fk_leagues enable row level security;
alter table public.fk_seats enable row level security;
alter table public.fk_outbox enable row level security;
alter table public.fk_config enable row level security;
revoke all on public.fk_leagues, public.fk_seats, public.fk_outbox, public.fk_config from anon, authenticated;

-- Plain text only, trimmed and capped.
create or replace function public.fk_clean(s text, n int) returns text
language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(s, ''), '[[:cntrl:]<>]', '', 'g'), '\s+', ' ', 'g')), n);
$$;

create or replace function public.fk_rand(n int) returns text
language sql volatile set search_path = public, extensions as $$
  select lower(substr(translate(encode(gen_random_bytes(16), 'base64'), '+/=lIO0o1', ''), 1, n));
$$;

-- Owners in the stored documents always come from the seats table, never from what a page sends.
create or replace function public.fk_stamp(p_id text, p_doc jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i int; n int; out jsonb := p_doc; m text;
begin
  if p_doc is null then return null; end if;
  n := coalesce(jsonb_array_length(p_doc->'teams'), 0);
  for i in 0 .. n - 1 loop
    select manager into m from fk_seats where league = p_id and team = i;
    out := jsonb_set(out, array['teams', i::text, 'owner'], coalesce(to_jsonb(m), 'null'::jsonb), true);
  end loop;
  return out;
end $$;

create or replace function public.fk_seat_map(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(team::text, manager), '{}'::jsonb) from fk_seats where league = p_id;
$$;

create or replace function public.fk_create(p_name text, p_sport text, p_manager text, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); new_id text; nm text := fk_clean(p_name, 40); mg text := fk_clean(p_manager, 24); inv text := fk_rand(6);
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Give the league a name.'); end if;
  if mg = '' then mg := 'Commissioner'; end if;
  if p_sport not in ('nba', 'nfl', 'mlb') then return jsonb_build_object('error', 'Pick a sport.'); end if;
  if jsonb_typeof(p_draft->'teams') is distinct from 'array' or jsonb_array_length(p_draft->'teams') < 2 then return jsonb_build_object('error', 'A league needs at least two teams.'); end if;
  if octet_length(p_draft::text) > 1500000 then return jsonb_build_object('error', 'That league is too big to save.'); end if;
  if (select count(*) from fk_leagues where commish = uid and created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('error', 'You''ve made 10 leagues today. Try again tomorrow.');
  end if;
  loop
    new_id := fk_rand(8);
    exit when not exists (select 1 from fk_leagues where id = new_id);
  end loop;
  insert into fk_leagues (id, name, sport, commish, invite, draft) values (new_id, nm, p_sport, uid, inv, p_draft);
  insert into fk_seats (league, team, user_id, email, manager) values (new_id, 0, uid, auth.jwt()->>'email', mg);
  update fk_leagues set draft = fk_stamp(new_id, draft) where id = new_id;
  return jsonb_build_object('id', new_id, 'invite', inv, 'version', 1);
end $$;

create or replace function public.fk_view(p_id text, p_since int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l fk_leagues; uid uuid := auth.uid(); mine int; out jsonb;
begin
  select * into l from fk_leagues where id = p_id;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select team into mine from fk_seats where league = p_id and user_id = uid;
  out := jsonb_build_object('version', l.version, 'now', (extract(epoch from now()) * 1000)::bigint, 'name', l.name, 'sport', l.sport,
    'me', mine, 'commish', uid is not null and uid = l.commish, 'seats', fk_seat_map(p_id),
    'notify', (select notify from fk_seats where league = p_id and user_id = uid));
  if uid is not null and uid = l.commish then out := out || jsonb_build_object('invite', l.invite); end if;
  if p_since is null or l.version > p_since then out := out || jsonb_build_object('draft', l.draft, 'league', l.league); end if;
  return out;
end $$;

create or replace function public.fk_join(p_id text, p_invite text, p_team int, p_manager text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l fk_leagues; mg text := fk_clean(p_manager, 24); n int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if l.invite <> coalesce(p_invite, '') then return jsonb_build_object('error', 'That invite code doesn''t match. Ask the commissioner for a new link.'); end if;
  if exists (select 1 from fk_seats where league = p_id and user_id = uid) then return jsonb_build_object('error', 'You already have a team in this league.'); end if;
  n := jsonb_array_length(l.draft->'teams');
  if p_team is null or p_team < 0 or p_team >= n then return jsonb_build_object('error', 'Pick a team.'); end if;
  if exists (select 1 from fk_seats where league = p_id and team = p_team) then return jsonb_build_object('error', 'Someone already took that team.'); end if;
  if mg = '' then return jsonb_build_object('error', 'Add your name.'); end if;
  insert into fk_seats (league, team, user_id, email, manager) values (p_id, p_team, uid, auth.jwt()->>'email', mg);
  update fk_leagues set draft = fk_stamp(p_id, draft), league = fk_stamp(p_id, league), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $$;

create or replace function public.fk_save(p_id text, p_version int, p_draft jsonb, p_league jsonb, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l fk_leagues; e jsonb; k int := 0;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if not exists (select 1 from fk_seats where league = p_id and user_id = uid) and uid <> l.commish then
    return jsonb_build_object('error', 'Only managers in this league can make moves.');
  end if;
  if l.version <> p_version then
    return jsonb_build_object('error', 'stale', 'version', l.version, 'draft', l.draft, 'league', l.league);
  end if;
  if octet_length(coalesce(p_draft::text, '')) + octet_length(coalesce(p_league::text, '')) > 3000000 then
    return jsonb_build_object('error', 'That league is too big to save.');
  end if;
  update fk_leagues set draft = fk_stamp(p_id, coalesce(p_draft, draft)), league = fk_stamp(p_id, coalesce(p_league, league)),
    version = version + 1, updated_at = now() where id = p_id;
  if jsonb_typeof(p_events) = 'array' then
    for e in select * from jsonb_array_elements(p_events) loop
      exit when k >= 40;
      if (e->>'team') ~ '^\d+$' and exists (select 1 from fk_seats where league = p_id and team = (e->>'team')::int and notify) then
        insert into fk_outbox (league, team, kind, subject, body)
          values (p_id, (e->>'team')::int, fk_clean(e->>'kind', 20), fk_clean(e->>'subject', 120), left(coalesce(e->>'body', ''), 2000));
        k := k + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $$;

create or replace function public.fk_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'sport', l.sport, 'team', s.team, 'commish', l.commish = auth.uid(),
    'phase', case when l.league is not null then 'season' else coalesce(l.draft->>'phase', 'setup') end, 'updated', l.updated_at) order by l.updated_at desc), '[]'::jsonb)
  from fk_leagues l left join fk_seats s on s.league = l.id and s.user_id = auth.uid()
  where auth.uid() is not null and (s.user_id is not null or l.commish = auth.uid());
$$;

create or replace function public.fk_notify(p_id text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update fk_seats set notify = coalesce(p_on, true) where league = p_id and user_id = auth.uid();
  if not found then return jsonb_build_object('error', 'You don''t have a team in this league.'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fk_leave(p_id text, p_team int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l fk_leagues; s fk_seats;
begin
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  select * into s from fk_seats where league = p_id and team = p_team;
  if not found then return jsonb_build_object('error', 'Nobody has that team.'); end if;
  if s.user_id <> auth.uid() and l.commish <> auth.uid() then return jsonb_build_object('error', 'Only that manager or the commissioner can do that.'); end if;
  if s.user_id = l.commish then return jsonb_build_object('error', 'The commissioner keeps a team.'); end if;
  delete from fk_seats where league = p_id and team = p_team;
  update fk_leagues set draft = fk_stamp(p_id, draft), league = fk_stamp(p_id, league), version = version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $$;

-- The mailer: unsent emails with where they go, a few at a time, then marks them sent or failed.
create or replace function public.fk_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from fk_config where name = 'mailer_token_sha256' and value = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex'));
$$;
create or replace function public.fk_outbox_take(p_token text, p_limit int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  with picked as (
    select o.id from fk_outbox o where o.sent_at is null and o.tries < 4 order by o.created_at limit least(coalesce(p_limit, 20), 50) for update skip locked
  ), bumped as (
    update fk_outbox o set tries = o.tries + 1 from picked where o.id = picked.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'league', b.league, 'league_name', l.name, 'team', b.team, 'kind', b.kind,
    'subject', b.subject, 'body', b.body, 'email', s.email, 'manager', s.manager)), '[]'::jsonb) into out
  from bumped b join fk_leagues l on l.id = b.league left join fk_seats s on s.league = b.league and s.team = b.team;
  return jsonb_build_object('emails', out);
end $$;
create or replace function public.fk_outbox_done(p_token text, p_ids bigint[], p_errors jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  update fk_outbox set sent_at = now(), error = null where id = any(p_ids) and not (coalesce(p_errors, '{}'::jsonb) ? id::text);
  update fk_outbox set error = left(p_errors->>(id::text), 300) where id = any(p_ids) and coalesce(p_errors, '{}'::jsonb) ? id::text;
  delete from fk_outbox where sent_at < now() - interval '30 days';
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fk_stamp(text, jsonb), public.fk_seat_map(text), public.fk_token_ok(text), public.fk_rand(int) from public, anon, authenticated;
grant execute on function public.fk_create(text, text, text, jsonb), public.fk_view(text, int), public.fk_join(text, text, int, text),
  public.fk_save(text, int, jsonb, jsonb, jsonb), public.fk_mine(), public.fk_notify(text, boolean), public.fk_leave(text, int) to anon, authenticated;
grant execute on function public.fk_outbox_take(text, int), public.fk_outbox_done(text, bigint[], jsonb) to anon;

-- Migration fantasykit_clock: the server clock's two functions.
create or replace function public.fk_clock_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'version', l.version, 'name', l.name, 'sport', l.sport,
    'updated', (extract(epoch from l.updated_at) * 1000)::bigint, 'seats', fk_seat_map(l.id),
    'draft', case when l.league is null then l.draft else null end, 'league', l.league)), '[]'::jsonb) into out
  from fk_leagues l
  where l.updated_at > now() - interval '150 days'
    and ((l.league is null and l.draft->>'phase' = 'live') or l.league is not null);
  return jsonb_build_object('leagues', out, 'now', (extract(epoch from now()) * 1000)::bigint);
end $$;

create or replace function public.fk_clock_save(p_token text, p_id text, p_version int, p_draft jsonb, p_league jsonb, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l fk_leagues; e jsonb; k int := 0;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  if l.version <> p_version then return jsonb_build_object('error', 'stale'); end if;
  update fk_leagues set draft = fk_stamp(p_id, coalesce(p_draft, draft)), league = fk_stamp(p_id, coalesce(p_league, league)),
    version = version + 1, updated_at = now() where id = p_id;
  if jsonb_typeof(p_events) = 'array' then
    for e in select * from jsonb_array_elements(p_events) loop
      exit when k >= 60;
      if (e->>'team') ~ '^\d+$' and exists (select 1 from fk_seats where league = p_id and team = (e->>'team')::int and notify) then
        insert into fk_outbox (league, team, kind, subject, body)
          values (p_id, (e->>'team')::int, fk_clean(e->>'kind', 20), fk_clean(e->>'subject', 120), left(coalesce(e->>'body', ''), 2000));
        k := k + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $$;

revoke all on function public.fk_clock_list(text), public.fk_clock_save(text, text, int, jsonb, jsonb, jsonb) from public, authenticated;
grant execute on function public.fk_clock_list(text), public.fk_clock_save(text, text, int, jsonb, jsonb, jsonb) to anon;

-- After deploying fk-clock, give it a token and schedule it (run once, with a long random token):
--   insert into fk_config values ('mailer_token_sha256', encode(extensions.digest('<token>', 'sha256'), 'hex'))
--     on conflict (name) do update set value = excluded.value;
--   insert into fk_config values ('mailer_token', '<token>') on conflict (name) do update set value = excluded.value;
--   select cron.schedule('fk-clock', '*/5 * * * *', $job$ select net.http_post(
--     url := 'https://baxrczyufqbzrogftmyn.supabase.co/functions/v1/fk-clock',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-fk-token', (select value from public.fk_config where name = 'mailer_token')),
--     body := '{}'::jsonb, timeout_milliseconds := 60000) $job$);
-- Emails go out once the function's secrets RESEND_API_KEY and FK_MAIL_FROM are set; until then they wait in fk_outbox.

-- ---------- next season: keepers, then a new draft (migration fantasykit_new_season) ----------
alter table fk_leagues add column if not exists seasons jsonb not null default '[]'::jsonb;

create or replace function fk_new_season(p_id text, p_version int, p_draft jsonb, p_summary jsonb, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l fk_leagues; e jsonb; k int := 0;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into l from fk_leagues where id = p_id for update;
  if not found then return jsonb_build_object('error', 'No league with that link.'); end if;
  if l.commish <> uid then return jsonb_build_object('error', 'Only the commissioner can start a new season.'); end if;
  if l.league is null then return jsonb_build_object('error', 'This league is already drafting.'); end if;
  if l.version <> p_version then return jsonb_build_object('error', 'stale', 'version', l.version, 'draft', l.draft, 'league', l.league); end if;
  if jsonb_typeof(p_draft->'teams') is distinct from 'array' then return jsonb_build_object('error', 'That draft is missing its teams.'); end if;
  if octet_length(p_draft::text) > 1500000 then return jsonb_build_object('error', 'That league is too big to save.'); end if;
  update fk_leagues set seasons = seasons || jsonb_build_array(coalesce(p_summary, '{}'::jsonb)), draft = fk_stamp(p_id, p_draft), league = null,
    version = version + 1, updated_at = now() where id = p_id;
  if jsonb_typeof(p_events) = 'array' then
    for e in select * from jsonb_array_elements(p_events) loop
      exit when k >= 40;
      if (e->>'team') ~ '^\d+$' and exists (select 1 from fk_seats where league = p_id and team = (e->>'team')::int and notify) then
        insert into fk_outbox (league, team, kind, subject, body)
          values (p_id, (e->>'team')::int, fk_clean(e->>'kind', 20), fk_clean(e->>'subject', 120), left(coalesce(e->>'body', ''), 2000));
        k := k + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $$;

create or replace function fk_history(p_id text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select seasons from fk_leagues where id = p_id), '[]'::jsonb);
$$;
grant execute on function fk_new_season(text, int, jsonb, jsonb, jsonb), fk_history(text) to anon, authenticated;
-- ---------- league chat (migration fantasykit_chat) ----------
create table if not exists fk_posts (
  id bigserial primary key,
  league text not null references fk_leagues(id) on delete cascade,
  team int not null,
  author text not null,
  body text not null,
  at timestamptz not null default now()
);
create index if not exists fk_posts_league_id on fk_posts (league, id);
alter table fk_posts enable row level security;
revoke all on public.fk_posts from anon, authenticated;

-- A manager posts to his league's chat: up to 500 characters, line breaks kept, eight posts a minute at most.
create or replace function fk_post(p_id text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; b text; r fk_posts;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into s from fk_seats where league = p_id and user_id = uid;
  if not found then return jsonb_build_object('error', 'Only managers in this league can post.'); end if;
  b := regexp_replace(coalesce(p_body, ''), '[\x01-\x09\x0b-\x1f\x7f]', '', 'g');
  b := regexp_replace(b, '\n{3,}', E'\n\n', 'g');
  b := left(btrim(b, E' \n'), 500);
  if b = '' then return jsonb_build_object('error', 'Write something first.'); end if;
  if (select count(*) from fk_posts where league = p_id and team = s.team and at > now() - interval '1 minute') >= 8 then
    return jsonb_build_object('error', 'Slow down a little, then try again.');
  end if;
  insert into fk_posts (league, team, author, body) values (p_id, s.team, s.manager, b) returning * into r;
  return jsonb_build_object('ok', true, 'post', jsonb_build_object('id', r.id, 'team', r.team, 'author', r.author, 'body', r.body, 'at', (extract(epoch from r.at) * 1000)::bigint));
end $$;

-- The newest 200 posts after p_after, oldest first. Anyone with the league's link can read, as with fk_view.
create or replace function fk_posts(p_id text, p_after bigint default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'team', team, 'author', author, 'body', body, 'at', (extract(epoch from at) * 1000)::bigint) order by id), '[]'::jsonb)
  from (select * from fk_posts where league = p_id and id > coalesce(p_after, 0) order by id desc limit 200) x;
$$;
revoke all on function fk_post(text, text), fk_posts(text, bigint) from public;
grant execute on function fk_post(text, text), fk_posts(text, bigint) to anon, authenticated;

-- ---------- Your leagues cards (migration fantasykit_league_cards) ----------
-- fk_card(l, team) adds to each fk_mine row: your team's name, team and seat counts, the week, your head-to-head
-- record, whether you're alive in a guillotine league, and the draft's pick count. See the migration for the body.
-- fantasykit_league_cards_median: fk_card's record also counts each week's game against the league median when
-- settings.median is on.

-- ---------- commissioner tools (migration fantasykit_commish_tools) ----------
-- fk_resize(p_id, p_version, p_draft, p_map): before the draft, the commissioner adds or removes teams; p_map moves
--   each claimed seat to its new team number, and a claimed team can't be removed.
-- fk_delete(p_id, p_name): the commissioner deletes the league (seats, chat and queued emails go with it); the name
--   has to match. Rule, roster, trade and team edits save through fk_save like any other move.

-- ---------- live box scores (migration fantasykit_live) ----------
-- supabase/functions/fk-live serves the current week's totals so far for each sport (verify_jwt off: public sports
-- data). fk_live keeps the last result about a minute; fk_live_games keeps each finished game's lines. Only the
-- function's service role touches either table.
create table if not exists fk_live (sport text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists fk_live_games (sport text not null, gid text not null, day date, final boolean not null default false, lines jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), primary key (sport, gid));
alter table fk_live enable row level security;
alter table fk_live_games enable row level security;
revoke all on public.fk_live, public.fk_live_games from anon, authenticated;

-- ---------- dues and invites (applied as migrations fk_dues, fk_team_name_member_invite) ----------
-- fk_leagues.dues jsonb: { amount, due, payout, high, note, pay: { venmo, paypal, cashapp, zelle }, paid: { team: ms }, claimed: { team: ms } }
-- fk_view returns invite and dues to the league's own managers (any seat, or the commissioner)
-- fk_dues_set(p_id, p_dues jsonb): commissioner only; top-level keys replace
-- fk_dues_claim(p_id, p_on boolean): a manager marks "I sent it" for their own team
-- fk_team_name(p_id, p_name): a manager names their own team in the draft and league docs (used right after joining)
alter table fk_leagues add column if not exists dues jsonb;

-- ---------- usernames and passwords (migration fk_usernames, edge function supabase/functions/fk-login) ----------
-- fk_usernames (user_id, username unique ignoring case), no policies: only these functions touch it
-- fk_username_free(p_username), fk_username_set(p_username), fk_login_email(p_username) (service role only, for fk-login)
-- trigger fk_username_on_signup on auth.users: a sign-up's user metadata username, if it's free
-- fk_profile_me also returns username

-- ---------- live nudges (Nov 2026) ----------
-- Every save to a shared league (a page's or the clock's) and every chat post nudges the pages that have it open,
-- through Realtime's broadcast API on the public topic fk:<league id>. pg_net sends it, so a save never waits on it.
-- The nudge carries only the new version number; a page then reads the league through fk_view, which still checks
-- who's allowed to see it. The key is the site's publishable key, already public in fantasy-kit/cloud.js.
create or replace function public.fk_nudge(p_topic text, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public, net as $$
begin
  perform net.http_post(
    url := 'https://baxrczyufqbzrogftmyn.supabase.co/realtime/v1/api/broadcast',
    body := jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('topic', p_topic, 'event', p_event, 'payload', p_payload))),
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4"}'::jsonb);
exception when others then null;   -- a nudge that can't go out never blocks the save
end $$;
revoke all on function public.fk_nudge(text, text, jsonb) from public, anon, authenticated;

create or replace function public.fk_nudge_save() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.version is distinct from old.version then perform public.fk_nudge('fk:' || new.id, 'save', jsonb_build_object('v', new.version)); end if;
  return new;
end $$;
create or replace function public.fk_nudge_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.fk_nudge('fk:' || new.league, 'post', jsonb_build_object('id', new.id));
  return new;
end $$;
drop trigger if exists fk_nudge_save on public.fk_leagues;
create trigger fk_nudge_save after update of version on public.fk_leagues for each row execute function public.fk_nudge_save();
drop trigger if exists fk_nudge_post on public.fk_posts;
create trigger fk_nudge_post after insert on public.fk_posts for each row execute function public.fk_nudge_post();
revoke all on function public.fk_nudge_save() from public, anon, authenticated;
revoke all on function public.fk_nudge_post() from public, anon, authenticated;

-- ---------- bots on time (Nov 2026) ----------
-- One league for the clock, in fk_clock_list's shape (a live draft woken by its own save).
create or replace function public.fk_clock_one(p_token text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb; nowms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'version', l.version, 'name', l.name, 'sport', l.sport,
    'updated', (extract(epoch from l.updated_at) * 1000)::bigint, 'seats', fk_seat_map(l.id),
    'draft', case when l.league is null then l.draft else null end, 'league', l.league)), '[]'::jsonb) into out
  from fk_leagues l where l.id = p_id;
  return jsonb_build_object('leagues', out, 'now', nowms);
end $$;
revoke all on function public.fk_clock_one(text, text) from public, anon, authenticated;
grant execute on function public.fk_clock_one(text, text) to anon;

-- Every save to a live draft wakes the clock for that league (fk-clock ?league=<id>), which makes the next bot pick
-- when it's due; that save wakes the next call. pg_net sends it, so the save never waits.
create or replace function public.fk_wake_clock() returns trigger
language plpgsql security definer set search_path = public, net as $$
begin
  if new.version is distinct from old.version and new.league is null and new.draft->>'phase' = 'live'
     and coalesce((new.draft->>'paused')::boolean, false) = false then
    begin
      perform net.http_post(
        url := 'https://baxrczyufqbzrogftmyn.supabase.co/functions/v1/fk-clock?league=' || new.id,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-fk-token', (select value from public.fk_config where name = 'mailer_token')),
        body := '{}'::jsonb, timeout_milliseconds := 30000);
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.fk_wake_clock() from public, anon, authenticated;
drop trigger if exists fk_wake_clock on public.fk_leagues;
create trigger fk_wake_clock after update of version on public.fk_leagues for each row execute function public.fk_wake_clock();

-- ============================================================================
-- Phone alerts (2026-11-11). Each device's web push subscription, by signed-in user. Every alert a manager would
-- get by email (fk_outbox) also goes to their devices. VAPID keys are Hard Cap's (hc_config), shared by the site.
-- fk-clock sends them (npm:web-push); ?mail=1 sends the outbox only, and fk_wake_mail calls it on each new alert.
-- ============================================================================
create table if not exists public.fk_push (
  endpoint text primary key,
  user_id uuid not null,
  sub jsonb not null,
  ua text,
  created_at timestamptz not null default now()
);
create index if not exists fk_push_user on public.fk_push (user_id);
alter table public.fk_push enable row level security;   -- no policies: only the functions below touch it

create or replace function public.fk_push_subscribe(p_sub jsonb, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ep text := p_sub->>'endpoint';
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first, so alerts know who you are.'); end if;
  if ep is null or ep !~ '^https://' or p_sub->'keys'->>'p256dh' is null or p_sub->'keys'->>'auth' is null then return jsonb_build_object('error', 'That device subscription is not valid.'); end if;
  insert into fk_push (endpoint, user_id, sub, ua) values (ep, uid, p_sub, left(p_ua, 200))
    on conflict (endpoint) do update set user_id = excluded.user_id, sub = excluded.sub, ua = excluded.ua, created_at = now();
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.fk_push_unsubscribe(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from fk_push where endpoint = p_endpoint and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fk_push_subscribe(jsonb, text) from public, anon;
revoke all on function public.fk_push_unsubscribe(text) from public, anon;
grant execute on function public.fk_push_subscribe(jsonb, text) to authenticated;
grant execute on function public.fk_push_unsubscribe(text) to authenticated;

-- for the clock: the keys to sign pushes, and dropping a device that's gone
create or replace function public.fk_clock_vapid(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  return (select jsonb_object_agg(name, value) from hc_config where name in ('vapid_public', 'vapid_private', 'vapid_subject'));
end $$;
create or replace function public.fk_clock_push_gone(p_token text, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  delete from fk_push where endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fk_clock_vapid(text) from public, authenticated;
revoke all on function public.fk_clock_push_gone(text, text) from public, authenticated;
grant execute on function public.fk_clock_vapid(text) to anon;
grant execute on function public.fk_clock_push_gone(text, text) to anon;

-- the outbox now says where each alert's manager has devices
create or replace function public.fk_outbox_take(p_token text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  with picked as (
    select o.id from fk_outbox o where o.sent_at is null and o.tries < 4 order by o.created_at limit least(coalesce(p_limit, 20), 50) for update skip locked
  ), bumped as (
    update fk_outbox o set tries = o.tries + 1 from picked where o.id = picked.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'league', b.league, 'league_name', l.name, 'sport', l.sport, 'team', b.team, 'kind', b.kind,
    'subject', b.subject, 'body', b.body, 'data', b.data, 'email', s.email, 'manager', s.manager,
    'push', (select coalesce(jsonb_agg(p.sub), '[]'::jsonb) from fk_push p where p.user_id = s.user_id))), '[]'::jsonb) into out
  from bumped b join fk_leagues l on l.id = b.league left join fk_seats s on s.league = b.league and s.team = b.team;
  return jsonb_build_object('emails', out);
end $$;

-- a new alert goes out now, not at the clock's next five-minute run
create or replace function public.fk_wake_mail() returns trigger
language plpgsql security definer set search_path = public, net as $$
begin
  begin
    perform net.http_post(
      url := 'https://baxrczyufqbzrogftmyn.supabase.co/functions/v1/fk-clock?mail=1',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-fk-token', (select value from public.fk_config where name = 'mailer_token')),
      body := '{}'::jsonb, timeout_milliseconds := 60000);
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function public.fk_wake_mail() from public, anon, authenticated;
drop trigger if exists fk_wake_mail on public.fk_outbox;
create trigger fk_wake_mail after insert on public.fk_outbox for each statement execute function public.fk_wake_mail();
-- Draft Lab: each signed-in manager's own board (the Rankings page's My board), one per sport, so it follows them
-- across devices. { ids: [player ids in order], tiers: [ids that end a tier], at: ms }; the newer copy wins.
create table if not exists public.fk_boards (
  user_id uuid not null,
  sport text not null,
  board jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, sport)
);
alter table public.fk_boards enable row level security;   -- no policies: only the functions below touch it

create or replace function public.fk_board_get(p_sport text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  return coalesce((select jsonb_build_object('board', board) from fk_boards where user_id = uid and sport = p_sport), jsonb_build_object('board', null));
end $$;
create or replace function public.fk_board_save(p_sport text, p_board jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if p_sport !~ '^[a-z]{2,8}$' then return jsonb_build_object('error', 'Unknown sport.'); end if;
  if p_board is null then delete from fk_boards where user_id = uid and sport = p_sport; return jsonb_build_object('ok', true); end if;
  if jsonb_typeof(p_board->'ids') <> 'array' or jsonb_array_length(p_board->'ids') > 400 or length(p_board::text) > 40000 then return jsonb_build_object('error', 'That board is not valid.'); end if;
  insert into fk_boards (user_id, sport, board, updated_at) values (uid, p_sport, p_board, now())
    on conflict (user_id, sport) do update set board = excluded.board, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fk_board_get(text) from public, anon;
revoke all on function public.fk_board_save(text, jsonb) from public, anon;
grant execute on function public.fk_board_get(text) to authenticated;
grant execute on function public.fk_board_save(text, jsonb) to authenticated;

-- 2026-11-12: the leagues list carries each league's look (settings.brand); fk_mine adds 'brand', l.league->'settings'->'brand'
-- (see migration fk_mine_brand for the full function).

-- ============================================================================
-- 2026-11-12: keeper leagues between seasons.
-- * fk_boards (above) and fk_mine's brand: see the migrations fk_boards and fk_mine_brand.
-- * yoenis_sheet_rows reads the Draft Lab league ('yoenis') keeper picks once they're open (migration
--   yoenis_sheet_from_draftlab), from league->next->list: [[name, round, year kept, set by the commissioner]].
-- * fk_keeper_error, called by fk_save after fk_gameday_error (migration fk_keeper_lock): after league->next->due only
--   the commissioner can change keepers; only the commissioner sets the deadline, the missed-deadline rule and
--   league->nextOrder.
-- ============================================================================
create or replace function public.fk_keeper_error(p_old jsonb, p_new jsonb, p_commish boolean, p_now bigint)
returns text language plpgsql immutable as $$
declare o jsonb := p_old->'next'; n jsonb := p_new->'next';
begin
  if p_commish or p_new is null or p_old is null then return null; end if;
  if coalesce(o->'due', 'null'::jsonb) <> coalesce(n->'due', 'null'::jsonb) then return 'Only the commissioner sets the keeper deadline.'; end if;
  if coalesce(o->'missed', 'null'::jsonb) <> coalesce(n->'missed', 'null'::jsonb) then return 'Only the commissioner sets the keeper deadline.'; end if;
  if coalesce(p_old->'nextOrder', 'null'::jsonb) <> coalesce(p_new->'nextOrder', 'null'::jsonb) then return 'Only the commissioner sets the draft order.'; end if;
  if jsonb_typeof(o->'due') = 'number' and p_now >= (o->>'due')::numeric
     and coalesce(o->'picks', '{}'::jsonb) <> coalesce(n->'picks', '{}'::jsonb) then return 'Keepers are locked. Ask the commissioner to change them.'; end if;
  return null;
end $$;
-- (fk_save itself: as in migration fk_keeper_lock, with the fk_keeper_error check after fk_gameday_error.)

-- ---------- manager emails and invites (migration fantasykit_contacts_invites) ----------
-- Managers' email addresses the commissioner keeps for each team (before anyone claims it, or a better address than
-- the one an account signed up with), and invites emailed to them. Commissioner only; the page never sees anyone
-- else's address. An outbox row with to_email goes to that address instead of the team's seat.
create table if not exists public.fk_contacts (
  league text not null references public.fk_leagues(id) on delete cascade,
  team int not null,
  email text,
  name text,
  invited_at timestamptz,
  invites int not null default 0,
  primary key (league, team)
);
alter table public.fk_contacts enable row level security;
alter table public.fk_outbox add column if not exists to_email text;
alter table public.fk_outbox add column if not exists to_name text;

create or replace function public.fk_outbox_take(p_token text, p_limit integer) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  with picked as (
    select o.id from fk_outbox o where o.sent_at is null and o.tries < 4 order by o.created_at limit least(coalesce(p_limit, 20), 50) for update skip locked
  ), bumped as (
    update fk_outbox o set tries = o.tries + 1 from picked where o.id = picked.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'league', b.league, 'league_name', l.name, 'sport', l.sport, 'team', b.team, 'kind', b.kind,
    'subject', b.subject, 'body', b.body, 'data', b.data, 'email', coalesce(b.to_email, s.email), 'manager', coalesce(b.to_name, s.manager),
    'push', case when b.to_email is not null then '[]'::jsonb else (select coalesce(jsonb_agg(p.sub), '[]'::jsonb) from fk_push p where p.user_id = s.user_id) end)), '[]'::jsonb) into out
  from bumped b join fk_leagues l on l.id = b.league left join fk_seats s on s.league = b.league and s.team = b.team;
  return jsonb_build_object('emails', out);
end $function$;

create or replace function public.fk_contacts(p_id text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare l fk_leagues;
begin
  select * into l from fk_leagues where id = p_id;
  if l.id is null or l.commish is distinct from auth.uid() then return jsonb_build_object('error', 'Only the commissioner can see managers'' email addresses.'); end if;
  return jsonb_build_object('ok', true, 'teams', coalesce((
    select jsonb_object_agg(t.team, jsonb_build_object('email', c.email, 'name', c.name, 'invited_at', c.invited_at, 'invites', coalesce(c.invites, 0), 'account', s.email, 'manager', s.manager))
    from (select team from fk_contacts where league = p_id union select team from fk_seats where league = p_id) t
    left join fk_contacts c on c.league = p_id and c.team = t.team left join fk_seats s on s.league = p_id and s.team = t.team), '{}'::jsonb));
end $$;

create or replace function public.fk_contact_set(p_id text, p_team int, p_email text, p_name text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare l fk_leagues; e text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  select * into l from fk_leagues where id = p_id;
  if l.id is null or l.commish is distinct from auth.uid() then return jsonb_build_object('error', 'Only the commissioner can change that.'); end if;
  if p_team is null or p_team < 0 or p_team >= jsonb_array_length(coalesce(l.league->'teams', l.draft->'teams')) then return jsonb_build_object('error', 'No such team.'); end if;
  if e is not null and e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('error', 'That isn''t an email address.'); end if;
  insert into fk_contacts (league, team, email, name) values (p_id, p_team, e, nullif(trim(coalesce(p_name, '')), ''))
    on conflict (league, team) do update set email = excluded.email, name = coalesce(excluded.name, fk_contacts.name);
  return jsonb_build_object('ok', true);
end $$;

-- email a team's invite: the league's invite link with the team picked, to the address on file; one an hour per team
create or replace function public.fk_invite_send(p_id text, p_team int, p_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare l fk_leagues; c fk_contacts; tname text; link text;
begin
  select * into l from fk_leagues where id = p_id;
  if l.id is null or l.commish is distinct from auth.uid() then return jsonb_build_object('error', 'Only the commissioner can send invites.'); end if;
  select * into c from fk_contacts where league = p_id and team = p_team;
  if c.email is null then return jsonb_build_object('error', 'Add an email address for that team first.'); end if;
  if c.invited_at is not null and c.invited_at > now() - interval '1 hour' then return jsonb_build_object('error', 'An invite went to that team in the last hour.'); end if;
  tname := coalesce(l.league->'teams'->p_team->>'name', l.draft->'teams'->p_team->>'name', 'a team');
  link := 'https://davidsolar.dev/fantasy-kit/leagues.html?join=' || p_id || '&code=' || l.invite || '&team=' || p_team;
  insert into fk_outbox (league, team, kind, subject, body, to_email, to_name, data)
  values (p_id, p_team, 'invite', l.name || ': you''re invited',
    'You''re invited to run ' || tname || ' in ' || l.name || ' on Draft Lab, the league''s new home.' ||
    case when nullif(trim(coalesce(p_note, '')), '') is not null then E'\n\n' || left(trim(p_note), 600) else '' end ||
    E'\n\nSign in or make an account, and the team is yours. Keepers, trades, chat and the draft all happen there.' ||
    E'\n\nOpen the league: ' || link,
    c.email, c.name, jsonb_build_object('url', link, 'invite', true));
  update fk_contacts set invited_at = now(), invites = invites + 1 where league = p_id and team = p_team;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fk_contacts(text), public.fk_contact_set(text, int, text, text), public.fk_invite_send(text, int, text) from public, anon;
grant execute on function public.fk_contacts(text), public.fk_contact_set(text, int, text, text), public.fk_invite_send(text, int, text) to authenticated;
