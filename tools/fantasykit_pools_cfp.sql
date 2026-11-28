-- College Football Playoff bracket pools (kind 'cfpo', /pools/cfp-bracket/). Picks: slots r1..r4 (first round),
-- q1..q4 (quarterfinals), s1, s2 (semifinals), ch (title game), each an ESPN team id, plus 'tb' (title game total).
-- Brackets lock at the first first-round kickoff and show to everyone then. The games are po_games comp 'cfb',
-- rounds 1 to 4 (round 0 is the bowls). Scoring is in fantasy-kit/pools-core.js (cfpo).

alter table mm_pools drop constraint if exists mm_pools_kind_check;
alter table mm_pools add constraint mm_pools_kind_check check (kind in ('survivor', 'five', 'nfl', 'bowls', 'nflpo', 'nflff', 'squares', 'bracket', 'props', 'oscars', 'mmff', 'cfpo'));

create or replace function po_cfp_lock(p_season int) returns timestamptz language sql stable security definer set search_path to 'public' as $$
  select min(kickoff) from po_games where comp = 'cfb' and season = p_season and round = 1
$$;

CREATE OR REPLACE FUNCTION public.mm_pool_create(p_name text, p_kind text, p_entry text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare uid uuid := auth.uid(); code text; nm text := left(trim(coalesce(p_name, '')), 40); yr int; sw int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make a pool.'); end if;
  if nm = '' then return jsonb_build_object('error', 'Name the pool.'); end if;
  if p_kind not in ('survivor', 'five', 'nfl', 'bowls', 'nflpo', 'nflff', 'squares', 'bracket', 'props', 'oscars', 'mmff', 'cfpo') then return jsonb_build_object('error', 'Pick a game.'); end if;
  if (select count(*) from mm_pools where owner = uid) >= 20 then return jsonb_build_object('error', 'That''s a lot of pools. Leave one first.'); end if;
  if p_kind = 'nfl' then
    yr := mm_nfl_season(); sw := mm_nfl_start(yr);
    if sw is null then return jsonb_build_object('error', 'The next week''s games aren''t set yet. Try again in a day or two.'); end if;
    if sw > 18 then return jsonb_build_object('error', 'The regular season is over. NFL survivor comes back in September.'); end if;
  elsif p_kind in ('bowls', 'nflpo', 'nflff', 'squares', 'props', 'cfpo') then
    yr := po_season();
  else
    yr := mm_season();
  end if;
  loop
    code := upper(substr(translate(encode(gen_random_bytes(9), 'base64'), '+/=0Oo1IiLl', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from mm_pools where id = code) and not exists (select 1 from pk_groups where id = code);
  end loop;
  insert into mm_pools (id, name, kind, season, owner, start_week, extra) values (code, nm, p_kind, yr, uid, sw,
    case when p_kind = 'squares' then '{"cap": 10, "pay": [20, 20, 20, 40]}'::jsonb when p_kind = 'props' then jsonb_build_object('props', mm_props_default()) else '{}'::jsonb end);
  insert into mm_members (pool, user_id, name) values (code, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''));
  return jsonb_build_object('ok', true, 'id', code, 'name', nm, 'kind', p_kind);
end $function$;

CREATE OR REPLACE FUNCTION public.mm_pool_join(p_code text, p_entry text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); p mm_pools;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to join a pool.'); end if;
  select * into p from mm_pools where id = upper(trim(coalesce(p_code, '')));
  if not found then
    if exists (select 1 from pk_groups where id = upper(trim(coalesce(p_code, '')))) then return jsonb_build_object('error', 'pickem', 'id', upper(trim(p_code))); end if;
    return jsonb_build_object('error', 'No pool has that code. Check it and try again.');
  end if;
  if coalesce((p.extra ->> 'closed')::boolean, false) and not exists (select 1 from mm_members where pool = p.id and user_id = uid) then
    return jsonb_build_object('error', 'The owner closed this pool to new entries.');
  end if;
  if (select count(*) from mm_members where pool = p.id) >= 200 then return jsonb_build_object('error', 'That pool is full.'); end if;
  if p.kind = 'nfl' and not exists (select 1 from mm_members where pool = p.id and user_id = uid)
     and (select max(kickoff) from pk_games where season = p.season and stype = 2 and week = p.start_week) <= now() then
    return jsonb_build_object('error', format('This pool started in week %s, and that week''s games have all kicked off. Make a new pool to play from this week.', p.start_week));
  end if;
  if p.kind = 'nflpo' and not exists (select 1 from mm_members where pool = p.id and user_id = uid) and po_nfl_lock(p.season) <= now() then
    return jsonb_build_object('error', 'The playoffs have started, so this bracket pool is closed to new entries.');
  end if;
  if p.kind = 'cfpo' and not exists (select 1 from mm_members where pool = p.id and user_id = uid) and po_cfp_lock(p.season) <= now() then
    return jsonb_build_object('error', 'The playoff has started, so this bracket pool is closed to new entries.');
  end if;
  insert into mm_members (pool, user_id, name) values (p.id, uid, nullif(left(trim(coalesce(p_entry, '')), 28), ''))
  on conflict (pool, user_id) do update set name = coalesce(excluded.name, mm_members.name);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'kind', p.kind);
end $function$;

-- the field comes from the college hub's projection until the committee's seeds are in po_field (comp 'cfb'); a team
-- is any ESPN id until then, and must be one of the twelve after
CREATE OR REPLACE FUNCTION public.mm_save_cfpo(p_pool text, p_picks jsonb, p_tb integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); p mm_pools; lk timestamptz; k text; t text; set_ boolean;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to make picks.'); end if;
  select * into p from mm_pools where id = p_pool;
  if not found or p.kind <> 'cfpo' then return jsonb_build_object('error', 'That isn''t a College Football Playoff bracket pool.'); end if;
  if not exists (select 1 from mm_members where pool = p.id and user_id = uid) then return jsonb_build_object('error', 'Join this pool to pick.'); end if;
  lk := po_cfp_lock(p.season);
  if lk is not null and now() >= lk then return jsonb_build_object('error', 'The playoff has started. Brackets are locked.'); end if;
  if jsonb_typeof(coalesce(p_picks, '{}'::jsonb)) <> 'object' then return jsonb_build_object('error', 'That isn''t a bracket.'); end if;
  set_ := (select count(*) from po_field where comp = 'cfb' and season = p.season) >= 12;
  for k, t in select * from jsonb_each_text(coalesce(p_picks, '{}'::jsonb)) loop
    if k !~ '^(r[1-4]|q[1-4]|s[12]|ch)$' then return jsonb_build_object('error', 'That isn''t a bracket slot.'); end if;
    if t !~ '^\d{1,6}$' then return jsonb_build_object('error', 'That isn''t a team.'); end if;
    if set_ and not exists (select 1 from po_field where comp = 'cfb' and season = p.season and team = t) then return jsonb_build_object('error', 'That team isn''t in the playoff.'); end if;
  end loop;
  delete from mm_picks where pool = p.id and user_id = uid;
  insert into mm_picks (pool, user_id, slot, team) select p.id, uid, key, value from jsonb_each_text(coalesce(p_picks, '{}'::jsonb));
  if p_tb is not null then insert into mm_picks (pool, user_id, slot, team) values (p.id, uid, 'tb', greatest(0, least(200, p_tb))::text); end if;
  return jsonb_build_object('ok', true);
end $function$;
grant execute on function mm_save_cfpo(text, jsonb, integer) to authenticated;
revoke execute on function mm_save_cfpo(text, jsonb, integer) from anon;

CREATE OR REPLACE FUNCTION public.mm_as(p_pool text, p_user uuid, p_fn text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); p mm_pools; old text := current_setting('request.jwt.claims', true); r jsonb; a jsonb := coalesce(p_args, '{}'::jsonb);
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found or p.owner is distinct from uid then return jsonb_build_object('error', 'Only the pool''s owner can make picks for someone.'); end if;
  if p_user = uid or not exists (select 1 from mm_members where pool = p.id and user_id = p_user) then return jsonb_build_object('error', 'They aren''t in this pool.'); end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  begin
    r := case p_fn
      when 'mm_pick' then mm_pick(p.id, (a ->> 'p_day')::int, a ->> 'p_team')
      when 'mm_pick_nfl' then mm_pick_nfl(p.id, (a ->> 'p_week')::int, a ->> 'p_team')
      when 'mm_pick_five' then mm_pick_five(p.id, array(select jsonb_array_elements_text(a -> 'p_teams')))
      when 'mm_save_bowls' then mm_save_bowls(p.id, a -> 'p_picks', (a ->> 'p_tb')::int)
      when 'mm_save_nflpo' then mm_save_nflpo(p.id, a -> 'p_picks', (a ->> 'p_tb')::int)
      when 'mm_save_cfpo' then mm_save_cfpo(p.id, a -> 'p_picks', (a ->> 'p_tb')::int)
      when 'mm_save_nflff' then mm_save_nflff(p.id, (a ->> 'p_round')::int, a -> 'p_lineup')
      when 'mm_save_bracket' then mm_save_bracket(p.id, a -> 'p_picks', (a ->> 'p_tb')::int)
      when 'mm_save_props' then mm_save_props(p.id, a -> 'p_picks', (a ->> 'p_tb')::int)
      when 'mm_save_mmff' then mm_save_mmff(p.id, (a ->> 'p_round')::int, a -> 'p_lineup')
      else jsonb_build_object('error', 'That isn''t a pick the owner can make.') end;
  exception when others then perform set_config('request.jwt.claims', coalesce(old, ''), true); raise;
  end;
  perform set_config('request.jwt.claims', coalesce(old, ''), true);
  if r is not null and not (r ? 'error') then
    insert into mm_log (pool, actor, target, what) values (p.id, uid, p_user, case p_fn when 'mm_save_nflff' then 'set a lineup for' when 'mm_save_mmff' then 'set a lineup for' when 'mm_save_nflpo' then 'filled out the bracket of' when 'mm_save_cfpo' then 'filled out the bracket of'
      when 'mm_save_bowls' then 'saved bowl picks for' when 'mm_save_bracket' then 'filled out the bracket of' when 'mm_save_props' then case when p.kind = 'oscars' then 'filled out the ballot of' else 'filled out the prop sheet of' end when 'mm_pick_five' then 'picked five teams for' else 'made a pick for' end);
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.mm_board_core(p_pool text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); p mm_pools; lk timestamptz;
begin
  select * into p from mm_pools where id = upper(trim(coalesce(p_pool, '')));
  if not found then return jsonb_build_object('error', 'No pool has that code.'); end if;
  if uid is null or not exists (select 1 from mm_members where pool = p.id and user_id = uid) then
    return jsonb_build_object('error', 'join', 'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'startWeek', p.start_week,
      'members', (select count(*) from mm_members where pool = p.id)), 'signedIn', uid is not null);
  end if;
  if p.kind = 'nfl' then
    return jsonb_build_object('ok', true, 'now', now(),
      'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'startWeek', p.start_week, 'owner', p.owner = uid),
      'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'week', g.week, 'kickoff', g.kickoff, 'away', g.away, 'home', g.home,
          'ap', g.away_score, 'hp', g.home_score, 'final', g.final, 'status', g.status, 'line', coalesce(g.spread, g.live_spread))
        order by g.kickoff, g.game_id) from pk_games g where g.season = p.season and g.stype = 2 and g.week >= p.start_week), '[]'::jsonb),
      'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
      'picks', coalesce((select jsonb_agg(jsonb_build_object('user', k.user_id, 'slot', k.slot,
          'team', case when k.user_id = uid or exists (select 1 from pk_games g where g.season = p.season and g.stype = 2 and g.week = substring(k.slot from 2)::int
            and k.team in (g.away, g.home) and g.kickoff <= now()) then k.team end))
        from mm_picks k where k.pool = p.id), '[]'::jsonb));
  end if;
  if p.kind in ('bowls', 'nflpo', 'nflff', 'squares', 'props', 'oscars', 'cfpo') then
    lk := case when p.kind in ('nflpo', 'nflff') then po_nfl_lock(p.season) when p.kind = 'cfpo' then po_cfp_lock(p.season) when p.kind = 'oscars' then mm_oscars_lock(p.season) when p.kind in ('squares', 'props') then (select min(kickoff) from po_games where comp = 'nfl' and season = p.season and round = 4) else (select min(kickoff) from po_games where comp = 'cfb' and season = p.season and round = 4) end;
    return jsonb_build_object('ok', true, 'now', now(), 'lock', lk,
      'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = uid, 'extra', p.extra),
      'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'round', g.round, 'label', g.label, 'conf', g.conf, 'kickoff', g.kickoff,
          'a', g.a, 'b', g.b, 'an', g.a_name, 'bn', g.b_name, 'ap', g.a_score, 'bp', g.b_score, 'w', g.winner, 'final', g.final, 'status', g.status, 'line', g.line, 'lines', g.lines)
        order by g.kickoff, g.game_id) from po_games g where g.comp = case when p.kind in ('bowls', 'cfpo') then 'cfb' when p.kind = 'oscars' then 'none' else 'nfl' end and g.season = p.season
          and (p.kind <> 'cfpo' or g.round >= 1)), '[]'::jsonb),
      'field', case when p.kind in ('nflpo', 'nflff', 'squares', 'props') then coalesce((select jsonb_agg(jsonb_build_object('team', f.team, 'conf', f.conf, 'seed', f.seed, 'name', f.name, 'pd', f.pd, 'gp', f.gp) order by f.conf, f.seed)
        from po_field f where f.comp = 'nfl' and f.season = p.season), '[]'::jsonb) end,
      'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
      'picks', coalesce((select jsonb_agg(x) from (select jsonb_build_object('user', k.user_id, 'slot', k.slot, 'team', k.team, 'pts', k.pts) x
        from mm_picks k where k.pool = p.id and (k.user_id = uid
          or (k.slot = 'tb' and lk is not null and now() >= lk)
          or (p.kind in ('nflpo', 'cfpo') and lk is not null and now() >= lk)
          or p.kind = 'squares'
          or (p.kind in ('props', 'oscars') and lk is not null and now() >= lk)
          or (p.kind = 'nflff' and k.slot ~ '^r[1-4]:' and po_team_kick(p.season, substring(k.slot from 2 for 1)::int, split_part(k.team, '@', 2)) <= now())
          or (p.kind = 'bowls' and exists (select 1 from po_games g where 'g' || g.game_id = k.slot and g.kickoff <= now())))) q), '[]'::jsonb));
  end if;
  lk := mm_five_lock(p.season);
  return jsonb_build_object('ok', true, 'now', now(), 'fiveLock', lk,
    'pool', jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'season', p.season, 'owner', p.owner = uid, 'extra', p.extra),
    'projected', exists (select 1 from mm_games where season = p.season and projected) and not exists (select 1 from mm_games where season = p.season and not projected),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.game_id, 'round', g.round, 'region', g.region, 'day', g.day, 'tip', g.tip,
        'a', g.a, 'b', g.b, 'as', g.a_seed, 'bs', g.b_seed, 'ap', g.a_score, 'bp', g.b_score, 'w', g.winner, 'status', g.status, 'final', g.final)
      order by g.tip, g.game_id) from mm_games g where g.season = p.season), '[]'::jsonb),
    'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', mm_name(p.id, m.user_id), 'me', m.user_id = uid) order by m.joined_at) from mm_members m where m.pool = p.id),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('user', k.user_id, 'slot', k.slot,
        'team', case when k.user_id = uid then k.team
          when p.kind in ('five', 'bracket') and lk is not null and now() >= lk then k.team
          when p.kind = 'mmff' and k.slot ~ '^r[1-6]:' and mm_team_tip(p.season, substring(k.slot from 2 for 1)::int, split_part(k.team, '@', 2)) <= now() then k.team
          when p.kind = 'survivor' and exists (select 1 from mm_games g where g.season = p.season and g.round >= 1 and k.team in (g.a, g.b)
            and g.day = mm_day_date(p.season, substring(k.slot from 2)::int) and g.tip <= now()) then k.team end))
      from mm_picks k where k.pool = p.id), '[]'::jsonb));
end $function$;
