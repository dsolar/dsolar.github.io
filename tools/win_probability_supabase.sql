-- Crowd votes for Win Probability (davidsolar.dev/win-probability/).
-- One-time setup: Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- Safe to run again. The browser never touches the table directly: it can only add a vote and read
-- the totals for one scenario, through the two functions below.

create table if not exists public.wp_votes (
  id bigint generated always as identity primary key,
  scenario text not null check (char_length(scenario) between 3 and 80),
  choice text not null check (choice in ('go', 'punt', 'fg', 'kick', 'two', 'let', 'defend')),
  created_at timestamptz not null default now()
);
create index if not exists wp_votes_scenario on public.wp_votes (scenario);

-- Row level security on with no policies: direct reads and writes from the browser are refused.
alter table public.wp_votes enable row level security;
revoke all on public.wp_votes from anon, authenticated;

create or replace function public.wp_vote(p_scenario text, p_choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wp_votes (scenario, choice) values (p_scenario, p_choice);
end;
$$;

create or replace function public.wp_tally(p_scenario text)
returns table (choice text, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select v.choice, count(*)::bigint as n
  from public.wp_votes v
  where v.scenario = p_scenario
  group by v.choice;
$$;

revoke all on function public.wp_vote(text, text) from public;
revoke all on function public.wp_tally(text) from public;
grant execute on function public.wp_vote(text, text) to anon, authenticated;
grant execute on function public.wp_tally(text) to anon, authenticated;
