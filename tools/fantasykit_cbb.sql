-- Add college basketball (one-day games) to shared leagues without changing ownership or save rules.
begin;
alter table public.fk_leagues drop constraint if exists fk_leagues_sport_check;
alter table public.fk_leagues add constraint fk_leagues_sport_check check (sport in ('nba', 'nfl', 'mlb', 'nhl', 'cbb'));

-- Keep the deployed version of fk_create, including all its current checks/grants.
do $$
declare definition text := pg_get_functiondef('public.fk_create(text,text,text,jsonb)'::regprocedure);
begin
  if position('''cbb''' in definition) = 0 then
    if position('(''nba'', ''nfl'', ''mlb'', ''nhl'')' in definition) = 0 then
      raise exception 'Unexpected fk_create sport validation; inspect it before updating';
    end if;
    execute replace(definition, '(''nba'', ''nfl'', ''mlb'', ''nhl'')', '(''nba'', ''nfl'', ''mlb'', ''nhl'', ''cbb'')');
  end if;
end $$;
commit;
