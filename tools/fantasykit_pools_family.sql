-- A pool's group, game after game: the owner starts another game for the same people (mm_pool_spawn), the members get
-- an invite (on the Pools page, the pool page, and one email: fk-clock poolInvites), and say yes or no (mm_invite_answer).
-- The pools link both ways: mm_pools.extra.from (the pool it came from) and extra.next (the ones started from it).

create table if not exists mm_invites (
  pool text not null references mm_pools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_pool text references mm_pools(id) on delete set null,
  by_user uuid,
  created_at timestamptz not null default now(),
  mailed_at timestamptz,
  primary key (pool, user_id)
);
alter table mm_invites enable row level security;
revoke all on mm_invites from anon, authenticated;
create index if not exists mm_invites_user on mm_invites (user_id);

CREATE OR REPLACE FUNCTION public.mm_pool_spawn(p_from text, p_kind text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); p mm_pools; r jsonb; nid text; n int; dup text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_from, '')));
  if not found or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can start a game for the group.'); end if;
  -- one of each game a season: a second tap opens the one already made
  select x into dup from jsonb_array_elements_text(coalesce(p.extra -> 'next', '[]'::jsonb)) x join mm_pools q on q.id = x
    where q.kind = p_kind and q.season = (case when p_kind in ('bowls', 'nflpo', 'nflff', 'squares', 'props', 'cfpo') then po_season() when p_kind = 'nfl' then mm_nfl_season() else mm_season() end) limit 1;
  if dup is not null then return jsonb_build_object('error', 'exists', 'id', dup, 'kind', p_kind); end if;
  r := mm_pool_create(coalesce(nullif(trim(coalesce(p_name, '')), ''), p.name), p_kind, (select name from mm_members where pool = p.id and user_id = uid));
  if not (r ? 'ok') then return r; end if;
  nid := r ->> 'id';
  update mm_pools set extra = extra || jsonb_strip_nulls(jsonb_build_object('buyin', p.extra -> 'buyin', 'payouts', p.extra -> 'payouts', 'champs', p.extra -> 'champs', 'from', p.id))
    where id = nid;
  update mm_pools set extra = jsonb_set(coalesce(extra, '{}'::jsonb), '{next}', coalesce(extra -> 'next', '[]'::jsonb) || to_jsonb(nid)) where id = p.id;
  insert into mm_invites (pool, user_id, from_pool, by_user) select nid, m.user_id, p.id, uid from mm_members m where m.pool = p.id and m.user_id <> uid
    on conflict do nothing;
  get diagnostics n = row_count;
  return r || jsonb_build_object('invited', n);
end $function$;

-- your open invites: pools you were asked into and haven't joined
CREATE OR REPLACE FUNCTION public.mm_invites_mine()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'kind', q.kind, 'season', q.season, 'from', i.from_pool, 'fromName', f.name,
      'by', case when i.from_pool is not null then mm_name(i.from_pool, i.by_user) end, 'members', (select count(*) from mm_members where pool = q.id), 'at', i.created_at)
    order by i.created_at desc), '[]'::jsonb)
  from mm_invites i join mm_pools q on q.id = i.pool left join mm_pools f on f.id = i.from_pool
  where i.user_id = auth.uid() and not exists (select 1 from mm_members m where m.pool = q.id and m.user_id = i.user_id)
$function$;

CREATE OR REPLACE FUNCTION public.mm_invite_answer(p_pool text, p_yes boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); i mm_invites; r jsonb;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into i from mm_invites where pool = upper(trim(coalesce(p_pool, ''))) and user_id = uid;
  if not found then return jsonb_build_object('error', 'That invite is gone.'); end if;
  if p_yes then
    r := mm_pool_join(i.pool, (select name from mm_members where pool = i.from_pool and user_id = uid));
    if not (r ? 'ok') then return r; end if;
  end if;
  delete from mm_invites where pool = i.pool and user_id = uid;
  return coalesce(r, jsonb_build_object('ok', true));
end $function$;

-- for fk-clock: invites not emailed yet (each is claimed as it's taken, so it's sent once); a member who already joined
-- or turned it down gets nothing
CREATE OR REPLACE FUNCTION public.mm_invite_mail_take(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare out jsonb;
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  with picked as (
    select i.pool, i.user_id from mm_invites i
    where i.mailed_at is null and i.created_at > now() - interval '3 days'
      and not exists (select 1 from mm_members m where m.pool = i.pool and m.user_id = i.user_id)
    order by i.created_at limit 40 for update skip locked
  ), marked as (
    update mm_invites i set mailed_at = now() from picked where i.pool = picked.pool and i.user_id = picked.user_id returning i.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('pool', q.id, 'pool_name', q.name, 'kind', q.kind, 'from_name', f.name, 'email', u.email,
      'name', case when m.from_pool is not null then mm_name(m.from_pool, m.user_id) end, 'by', case when m.from_pool is not null then mm_name(m.from_pool, m.by_user) end)), '[]'::jsonb) into out
  from marked m join mm_pools q on q.id = m.pool left join mm_pools f on f.id = m.from_pool join auth.users u on u.id = m.user_id
  where u.email is not null;
  return jsonb_build_object('invites', out);
end $function$;

revoke execute on function mm_pool_spawn(text, text, text), mm_invites_mine(), mm_invite_answer(text, boolean) from anon;
grant execute on function mm_pool_spawn(text, text, text), mm_invites_mine(), mm_invite_answer(text, boolean) to authenticated;
revoke execute on function mm_invite_mail_take(text) from anon, authenticated;

-- the board: the group's other games (where it came from, what's been started from it), and whether you're in each
CREATE OR REPLACE FUNCTION public.mm_board(p_pool text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b jsonb; p mm_pools; uid uuid := auth.uid();
begin
  b := mm_board_core(p_pool);
  if not (b ? 'ok') then return b; end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  b := jsonb_set(b, '{pool,extra}', coalesce(p.extra, '{}'::jsonb));
  b := jsonb_set(b, '{members}', coalesce((select jsonb_agg(m.v || jsonb_build_object('paid', coalesce(mb.paid, false), 'owner', mb.user_id = p.owner) order by m.o)
    from jsonb_array_elements(b -> 'members') with ordinality m(v, o) left join mm_members mb on mb.pool = p.id and mb.user_id = (m.v ->> 'id')::uuid), '[]'::jsonb));
  b := b || jsonb_build_object('log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'who', mm_name(p.id, l.actor), 'what', l.what, 'whom', mm_name(p.id, l.target)) order by l.at desc)
    from (select * from mm_log where pool = p.id order by at desc limit 12) l), '[]'::jsonb));
  b := b || jsonb_build_object('links', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'kind', q.kind, 'season', q.season, 'rel', x.rel,
      'in', exists (select 1 from mm_members m where m.pool = q.id and m.user_id = uid),
      'invited', exists (select 1 from mm_invites i where i.pool = q.id and i.user_id = uid),
      'members', (select count(*) from mm_members m where m.pool = q.id)) order by x.o)
    from (select p.extra ->> 'from' as id, 'from' as rel, 0::bigint as o where p.extra ? 'from'
          union all select n, 'next', o from jsonb_array_elements_text(coalesce(p.extra -> 'next', '[]'::jsonb)) with ordinality t(n, o)
          -- and the games started alongside this one
          union all select n, 'next', 100 + o from jsonb_array_elements_text(coalesce((select f.extra -> 'next' from mm_pools f where f.id = p.extra ->> 'from'), '[]'::jsonb)) with ordinality t(n, o) where n <> p.id) x
    join mm_pools q on q.id = x.id), '[]'::jsonb));
  return b;
end $function$;
