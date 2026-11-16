-- Add hockey to existing shared leagues without changing ownership or save rules.
begin;
alter table public.fk_leagues drop constraint if exists fk_leagues_sport_check;
alter table public.fk_leagues add constraint fk_leagues_sport_check check (sport in ('nba', 'nfl', 'mlb', 'nhl'));

-- Keep the deployed version of fk_create, including all its current checks/grants.
do $$
declare definition text := pg_get_functiondef('public.fk_create(text,text,text,jsonb)'::regprocedure);
begin
  if position('''nhl''' in definition) = 0 then
    if position('(''nba'', ''nfl'', ''mlb'')' in definition) = 0 then
      raise exception 'Unexpected fk_create sport validation; inspect it before updating';
    end if;
    execute replace(definition, '(''nba'', ''nfl'', ''mlb'')', '(''nba'', ''nfl'', ''mlb'', ''nhl'')');
  end if;
end $$;
commit;
