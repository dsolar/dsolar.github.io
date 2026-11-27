-- Draft Lab league polls: a chat post with a question and 2 to 6 choices, open for a set time. Any manager can start
-- one; each team gets one vote (a co-manager's vote is his team's), which it can change or take back until the poll
-- closes. Votes ride on the reactions check (fk_reacts gains "votes"), so the league page needs no new poll of its own.
--   fk_poll(league, question, ["choice", ...], hours)   start one (hours 1 to 336, default 72)
--   fk_vote(league, post, choice index)                 vote; the same choice again takes it back
-- Run after fantasykit_supabase.sql and fantasykit_reactions.sql.

alter table public.fk_posts add column if not exists poll jsonb;   -- { q, opts: [..], closes: epoch ms }

create table if not exists public.fk_votes (
  post bigint not null references public.fk_posts(id) on delete cascade,
  league text not null references public.fk_leagues(id) on delete cascade,
  team int not null,
  user_id uuid not null,
  opt int not null,
  at timestamptz not null default now(),
  primary key (post, team)
);
create index if not exists fk_votes_league on public.fk_votes (league);
alter table public.fk_votes enable row level security;   -- no policies: only the functions below touch it
revoke all on public.fk_votes from anon, authenticated;

-- the league's votes on its latest 300 posts: [{ post, team, opt, me }]
create or replace function public.fk_vote_list(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('post', v.post, 'team', v.team, 'opt', v.opt, 'me', v.user_id = auth.uid()) order by v.post, v.team), '[]'::jsonb)
  from fk_votes v where v.league = p_id and v.post >= coalesce((select min(id) from (select id from fk_posts where league = p_id order by id desc limit 300) x), 0);
$$;

create or replace function public.fk_poll(p_id text, p_q text, p_opts jsonb, p_hours int default 72) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; q text; o text; opts text[] := '{}'; h int; r fk_posts; pl jsonb;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into s from fk_seats where league = p_id and user_id = uid;
  if not found then return jsonb_build_object('error', 'Only managers in this league can start a poll.'); end if;
  q := left(btrim(regexp_replace(coalesce(p_q, ''), '[\x01-\x1f\x7f]+', ' ', 'g')), 200);
  if length(q) < 3 then return jsonb_build_object('error', 'Ask a question first.'); end if;
  if jsonb_typeof(p_opts) = 'array' then
    for o in select jsonb_array_elements_text(p_opts) loop
      o := left(btrim(regexp_replace(o, '[\x01-\x1f\x7f]+', ' ', 'g')), 80);
      if o <> '' and not (lower(o) = any (select lower(x) from unnest(opts) x)) then opts := opts || o; end if;
    end loop;
  end if;
  if coalesce(array_length(opts, 1), 0) not between 2 and 6 then return jsonb_build_object('error', 'Give it 2 to 6 different choices.'); end if;
  h := least(greatest(coalesce(p_hours, 72), 1), 336);
  if (select count(*) from fk_posts where league = p_id and team = s.team and poll is not null and at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('error', 'That''s a lot of polls. Try again in a little while.');
  end if;
  pl := jsonb_build_object('q', q, 'opts', to_jsonb(opts), 'closes', (extract(epoch from now() + make_interval(hours => h)) * 1000)::bigint);
  insert into fk_posts (league, team, author, body, poll) values (p_id, s.team, s.manager, 'Poll: ' || q, pl) returning * into r;
  return jsonb_build_object('ok', true, 'post', jsonb_build_object('id', r.id, 'team', r.team, 'author', r.author, 'body', r.body, 'poll', r.poll, 'at', (extract(epoch from r.at) * 1000)::bigint));
end $$;

create or replace function public.fk_vote(p_id text, p_post bigint, p_opt int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; pl jsonb; t timestamptz := clock_timestamp();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into s from fk_seats where league = p_id and user_id = uid;
  if not found then return jsonb_build_object('error', 'Only managers in this league can vote.'); end if;
  select poll into pl from fk_posts where id = p_post and league = p_id;
  if pl is null then return jsonb_build_object('error', 'That poll is gone.'); end if;
  if (pl->>'closes')::bigint <= (extract(epoch from now()) * 1000)::bigint then return jsonb_build_object('error', 'This poll has closed.'); end if;
  if p_opt is null or p_opt < 0 or p_opt >= jsonb_array_length(pl->'opts') then return jsonb_build_object('error', 'Pick one of the choices.'); end if;
  if exists (select 1 from fk_votes where post = p_post and team = s.team and opt = p_opt) then
    delete from fk_votes where post = p_post and team = s.team;
  else
    insert into fk_votes (post, league, team, user_id, opt) values (p_post, p_id, s.team, uid, p_opt)
      on conflict (post, team) do update set opt = excluded.opt, user_id = excluded.user_id, at = now();
  end if;
  insert into fk_react_marks (league, at) values (p_id, t) on conflict (league) do update set at = excluded.at;
  return jsonb_build_object('ok', true, 'at', (extract(epoch from t) * 1000)::bigint, 'votes', fk_vote_list(p_id));
end $$;

-- chat posts carry their poll
create or replace function public.fk_posts(p_id text, p_after bigint default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'team', team, 'author', author, 'body', body, 'poll', poll, 'at', (extract(epoch from at) * 1000)::bigint) order by id), '[]'::jsonb)
  from (select * from fk_posts where league = p_id and id > coalesce(p_after, 0) order by id desc limit 200) x;
$$;

-- the reactions check, now with the votes
create or replace function public.fk_reacts(p_id text, p_since bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m timestamptz; ms bigint;
begin
  select at into m from fk_react_marks where league = p_id;
  if m is null then return jsonb_build_object('at', 0, 'list', '[]'::jsonb, 'votes', '[]'::jsonb); end if;
  ms := (extract(epoch from m) * 1000)::bigint;
  if ms <= coalesce(p_since, 0) then return jsonb_build_object('at', ms); end if;
  return jsonb_build_object('at', ms, 'list', fk_react_list(p_id), 'votes', fk_vote_list(p_id));
end $$;

revoke all on function public.fk_poll(text, text, jsonb, int), public.fk_vote(text, bigint, int) from public, anon;
grant execute on function public.fk_poll(text, text, jsonb, int), public.fk_vote(text, bigint, int) to authenticated;
revoke all on function public.fk_vote_list(text) from public, anon, authenticated;
grant execute on function public.fk_posts(text, bigint), public.fk_reacts(text, bigint) to anon, authenticated;
