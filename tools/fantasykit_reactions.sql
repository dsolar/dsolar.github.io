-- Draft Lab chat reactions: tap an emoji under a post. One of each emoji per person per post, from a fixed set,
-- by managers in the league (co-managers count as themselves). fk_react toggles one and returns the league's
-- reactions; fk_reacts is the chat poll's cheap check: nothing back unless a reaction changed since p_since.
-- Run after fantasykit_supabase.sql.

create table if not exists public.fk_reacts (
  post bigint not null references public.fk_posts(id) on delete cascade,
  user_id uuid not null,
  league text not null references public.fk_leagues(id) on delete cascade,
  team int not null,
  emoji text not null,
  at timestamptz not null default now(),
  primary key (post, user_id, emoji)
);
create index if not exists fk_reacts_league on public.fk_reacts (league);
alter table public.fk_reacts enable row level security;   -- no policies: only the functions below touch it
revoke all on public.fk_reacts from anon, authenticated;

-- when each league's reactions last changed (a removal leaves no row to date it)
create table if not exists public.fk_react_marks (
  league text primary key references public.fk_leagues(id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.fk_react_marks enable row level security;
revoke all on public.fk_react_marks from anon, authenticated;

-- the league's reactions on its latest 300 posts: [{ post, e, team, me }]
create or replace function public.fk_react_list(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('post', r.post, 'e', r.emoji, 'team', r.team, 'me', r.user_id = auth.uid()) order by r.post, r.at), '[]'::jsonb)
  from fk_reacts r where r.league = p_id and r.post >= coalesce((select min(id) from (select id from fk_posts where league = p_id order by id desc limit 300) x), 0);
$$;

create or replace function public.fk_reacts(p_id text, p_since bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m timestamptz; ms bigint;
begin
  select at into m from fk_react_marks where league = p_id;
  if m is null then return jsonb_build_object('at', 0, 'list', '[]'::jsonb); end if;
  ms := (extract(epoch from m) * 1000)::bigint;
  if ms <= coalesce(p_since, 0) then return jsonb_build_object('at', ms); end if;
  return jsonb_build_object('at', ms, 'list', fk_react_list(p_id));
end $$;

create or replace function public.fk_react(p_id text, p_post bigint, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s fk_seats; t timestamptz := clock_timestamp();
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if coalesce(p_emoji, '') not in ('👍', '😂', '🔥', '😮', '💀', '🗑️') then return jsonb_build_object('error', 'Pick one of the reactions.'); end if;
  select * into s from fk_seats where league = p_id and user_id = uid;
  if not found then return jsonb_build_object('error', 'Only managers in this league can react.'); end if;
  if not exists (select 1 from fk_posts where id = p_post and league = p_id) then return jsonb_build_object('error', 'That post is gone.'); end if;
  if exists (select 1 from fk_reacts where post = p_post and user_id = uid and emoji = p_emoji) then
    delete from fk_reacts where post = p_post and user_id = uid and emoji = p_emoji;
  else
    if (select count(*) from fk_reacts where league = p_id and user_id = uid and at > now() - interval '1 minute') >= 30 then
      return jsonb_build_object('error', 'Slow down a little, then try again.');
    end if;
    insert into fk_reacts (post, user_id, league, team, emoji) values (p_post, uid, p_id, s.team, p_emoji);
  end if;
  insert into fk_react_marks (league, at) values (p_id, t) on conflict (league) do update set at = excluded.at;
  return jsonb_build_object('ok', true, 'at', (extract(epoch from t) * 1000)::bigint, 'list', fk_react_list(p_id));
end $$;

revoke all on function public.fk_react(text, bigint, text) from public, anon;
grant execute on function public.fk_react(text, bigint, text) to authenticated;
grant execute on function public.fk_reacts(text, bigint) to anon, authenticated;
revoke all on function public.fk_react_list(text) from public, anon, authenticated;
