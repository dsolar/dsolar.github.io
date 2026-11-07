-- Reject roster changes involving a player whose game started, including older clients.
-- Feed kickoff times are server-owned; player roster ids come from the saved documents.
create or replace function public.fk_gameday_error(old_doc jsonb, new_doc jsonb, live jsonb, at_ms numeric)
returns text language plpgsql immutable set search_path = public as $$
declare ws numeric; we numeric; old_week int; pid text; kickoff numeric; item record;
begin
  if old_doc is null or new_doc is null or not coalesce((old_doc#>>'{settings,real}')::boolean,false) then return null; end if;
  if old_doc->'rosters' = new_doc->'rosters' then return null; end if;
  old_week := (old_doc->>'week')::int;
  ws := (old_doc->>'start')::numeric + (old_week-1)*604800000; we := ws+604800000;
  -- Allow normal week rollover, chops and end-of-season work only after the actual week ends.
  if at_ms >= we then return null; end if;
  if old_doc->'week' is distinct from new_doc->'week' or old_doc->'start' is distinct from new_doc->'start' then
    return 'Roster moves cannot change the current scoring week before it ends.';
  end if;
  for item in
    with before_players as (
      select p.value as pid, r.ord as team from jsonb_array_elements(old_doc->'rosters') with ordinality r(value,ord)
      cross join lateral jsonb_array_elements_text(r.value) p(value)
    ), after_players as (
      select p.value as pid, r.ord as team from jsonb_array_elements(new_doc->'rosters') with ordinality r(value,ord)
      cross join lateral jsonb_array_elements_text(r.value) p(value)
    )
    select coalesce(a.pid,b.pid) as pid from before_players a full join after_players b on a.pid=b.pid
    where a.team is distinct from b.team
  loop
    pid := item.pid;
    kickoff := (live->'kicks'->>pid)::numeric;
    if kickoff >= ws and kickoff < we and at_ms >= kickoff then
      return 'That player’s game has started. Roster changes unlock next scoring week.';
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.fk_gameday_error(jsonb,jsonb,jsonb,numeric) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fk_save(p_id text, p_version integer, p_draft jsonb, p_league jsonb, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); l fk_leagues; e jsonb; k int := 0; game_error text;
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
  game_error := public.fk_gameday_error(l.league, p_league,
    (select data from public.fk_live where sport = l.sport), extract(epoch from clock_timestamp())*1000);
  if game_error is not null then return jsonb_build_object('error', game_error); end if;
  update fk_leagues set draft = fk_stamp(p_id, coalesce(p_draft, draft)), league = fk_stamp(p_id, coalesce(p_league, league)),
    version = version + 1, updated_at = now() where id = p_id;
  if jsonb_typeof(p_events) = 'array' then
    for e in select * from jsonb_array_elements(p_events) loop
      exit when k >= 40;
      if (e->>'team') ~ '^\d+$' and exists (select 1 from fk_seats where league = p_id and team = (e->>'team')::int and notify) then
        insert into fk_outbox (league, team, kind, subject, body, data)
          values (p_id, (e->>'team')::int, fk_clean(e->>'kind', 20), fk_clean(e->>'subject', 120), left(coalesce(e->>'body', ''), 2000), fk_event_data(e));
        k := k + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'version', l.version + 1);
end $function$

