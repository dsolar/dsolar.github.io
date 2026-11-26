-- On-time starts for the site's scheduled GitHub jobs. GitHub has been starting scheduled workflows hours late (a
-- 5:17am NBA pull starting mid-afternoon), so Supabase's pg_cron, which runs on time, starts them instead through
-- GitHub's workflow_dispatch API, on the same timetable as each workflow's own cron lines (UTC). The workflows keep
-- their GitHub schedules as a fallback: if the token is missing or expired, they still run, just late, and a late
-- second run of the same job only commits what changed.
--
-- Token: a fine-grained GitHub personal access token for dsolar/dsolar.github.io with Actions: Read and write, saved in
-- Supabase Vault by David (never in this repo):  select vault.create_secret('<token>', 'github_actions_dispatch');
-- To replace it later:  select vault.update_secret((select id from vault.secrets where name = 'github_actions_dispatch'), '<new token>');
-- Check it's working:   select * from public.gh_dispatch_status();   (GitHub answers 204 to a dispatch it accepted)
-- Workflows whose steps act differently on the daily schedule declare a "by" input; the scheduler sends by=cron to them.
-- Regenerate the job list after changing a workflow's cron lines (the cron.schedule calls below mirror them).

create table if not exists public.gh_dispatch_log (id bigserial primary key, at timestamptz not null default now(), workflow text not null, req bigint, note text);
alter table public.gh_dispatch_log enable row level security;

create or replace function public.gh_dispatch(p_wf text, p_inputs jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path to 'public', 'net' as $$
declare tok text; rid bigint;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_actions_dispatch' limit 1;
  if tok is null or tok = '' then insert into gh_dispatch_log (workflow, note) values (p_wf, 'no token'); return null; end if;
  select net.http_post(
    url := format('https://api.github.com/repos/dsolar/dsolar.github.io/actions/workflows/%s/dispatches', p_wf),
    body := jsonb_build_object('ref', 'main') || case when p_inputs <> '{}'::jsonb then jsonb_build_object('inputs', p_inputs) else '{}'::jsonb end,
    headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json', 'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'davidsolar-dev-scheduler', 'Content-Type', 'application/json'),
    timeout_milliseconds := 20000) into rid;
  insert into gh_dispatch_log (workflow, req) values (p_wf, rid);
  delete from gh_dispatch_log where at < now() - interval '30 days';
  return rid;
end $$;

-- the last day's starts and what GitHub said (pg_net keeps responses for a few hours)
create or replace function public.gh_dispatch_status() returns table (at timestamptz, workflow text, status int, note text)
language sql stable security definer set search_path to 'public', 'net' as $$
  select l.at, l.workflow, r.status_code, coalesce(l.note, case when r.status_code = 204 then 'started' when r.id is null then 'no answer kept' else left(r.content, 160) end)
  from gh_dispatch_log l left join net._http_response r on r.id = l.req where l.at > now() - interval '1 day' order by l.at desc;
$$;
revoke all on function public.gh_dispatch(text, jsonb), public.gh_dispatch_status() from public, anon, authenticated;

-- the timetable (38 starts, mirroring the workflows' cron lines)
select cron.unschedule(jobname) from cron.job where jobname like 'gh-%';
select cron.schedule('gh-calendar-update-1', '41 10 * * *', $$select public.gh_dispatch('calendar-update.yml')$$);
select cron.schedule('gh-cbb-hub-1', '23 4,11,18 * * *', $$select public.gh_dispatch('cbb-hub.yml')$$);
select cron.schedule('gh-cfb-hub-1', '41 4,11,18 * * *', $$select public.gh_dispatch('cfb-hub.yml', '{"by": "cron"}')$$);
select cron.schedule('gh-cfb-hub-2', '11,41 16-23 * * 6', $$select public.gh_dispatch('cfb-hub.yml', '{"by": "cron"}')$$);
select cron.schedule('gh-draft-board-1', '17 12 * * *', $$select public.gh_dispatch('draft-board.yml')$$);
select cron.schedule('gh-faces-1', '53 12 * * *', $$select public.gh_dispatch('faces.yml')$$);
select cron.schedule('gh-fantasykit-data-1', '47 11 * * *', $$select public.gh_dispatch('fantasykit-data.yml')$$);
select cron.schedule('gh-fantasykit-data-2', '17 22 * * *', $$select public.gh_dispatch('fantasykit-data.yml')$$);
select cron.schedule('gh-fantasykit-data-3', '7 17,19,21,23 * * 0', $$select public.gh_dispatch('fantasykit-data.yml')$$);
select cron.schedule('gh-fantasykit-data-4', '7 1,3,5,23 * * 1', $$select public.gh_dispatch('fantasykit-data.yml')$$);
select cron.schedule('gh-fantasykit-data-5', '7 1,3,5 * * 2,5', $$select public.gh_dispatch('fantasykit-data.yml')$$);
select cron.schedule('gh-fantasykit-data-6', '37 21,23 * * 6', $$select public.gh_dispatch('fantasykit-data.yml')$$);
select cron.schedule('gh-guillotine-update-1', '17 14 * 9-12,1 *', $$select public.gh_dispatch('guillotine-update.yml')$$);
select cron.schedule('gh-guillotine-update-2', '47 9,11 * 9-12,1 *', $$select public.gh_dispatch('guillotine-update.yml')$$);
select cron.schedule('gh-guillotine-update-3', '7,22,37,52 14-23 * 9-12,1 0', $$select public.gh_dispatch('guillotine-update.yml')$$);
select cron.schedule('gh-guillotine-update-4', '7,22,37,52 0-5 * 9-12,1 1', $$select public.gh_dispatch('guillotine-update.yml')$$);
select cron.schedule('gh-guillotine-update-5', '7,22,37,52 22-23 * 9-12,1 1,4', $$select public.gh_dispatch('guillotine-update.yml')$$);
select cron.schedule('gh-guillotine-update-6', '7,22,37,52 0-5 * 9-12,1 2,5', $$select public.gh_dispatch('guillotine-update.yml')$$);
select cron.schedule('gh-hardcap-stats-1', '41 10 * 10-12,1-6 *', $$select public.gh_dispatch('hardcap-stats.yml')$$);
select cron.schedule('gh-hardcap-stats-2', '11 21 * 10-12,1-6 *', $$select public.gh_dispatch('hardcap-stats.yml')$$);
select cron.schedule('gh-mlb-hub-1', '23 11 * * *', $$select public.gh_dispatch('mlb-hub.yml')$$);
select cron.schedule('gh-mlb-stats-1', '37 13 * * 1', $$select public.gh_dispatch('mlb-stats.yml', '{"by": "cron"}')$$);
select cron.schedule('gh-nba-darko-1', '37 13 * * *', $$select public.gh_dispatch('nba-darko.yml')$$);
select cron.schedule('gh-nba-fresh-1', '17 19 * * *', $$select public.gh_dispatch('nba-fresh.yml')$$);
select cron.schedule('gh-nba-lineups-1', '41 15 * * *', $$select public.gh_dispatch('nba-lineups.yml')$$);
select cron.schedule('gh-nba-live-1', '17 10 * 10-12,1-6 *', $$select public.gh_dispatch('nba-live.yml')$$);
select cron.schedule('gh-nba-picks-1', '23 14 * * *', $$select public.gh_dispatch('nba-picks.yml')$$);
select cron.schedule('gh-nba-ratings-1', '13 14 * * *', $$select public.gh_dispatch('nba-ratings.yml')$$);
select cron.schedule('gh-nba-ratings-2', '47 22 * * *', $$select public.gh_dispatch('nba-ratings.yml')$$);
select cron.schedule('gh-nba-ringer-1', '41 15 * * *', $$select public.gh_dispatch('nba-ringer.yml')$$);
select cron.schedule('gh-nba-tracking-1', '23 */6 * * *', $$select public.gh_dispatch('nba-tracking.yml', '{"by": "cron"}')$$);
select cron.schedule('gh-nfl-hub-1', '47 16 * * *', $$select public.gh_dispatch('nfl-hub.yml', '{"by": "cron"}')$$);
select cron.schedule('gh-nhl-hub-1', '41 10 * * *', $$select public.gh_dispatch('nhl-hub.yml')$$);
select cron.schedule('gh-tonight-1', '23 12,16,20,23,2 * * *', $$select public.gh_dispatch('tonight.yml')$$);
select cron.schedule('gh-torvik-1', '41 18 * * *', $$select public.gh_dispatch('torvik.yml', '{"by": "cron"}')$$);
select cron.schedule('gh-yoenis-yahoo-1', '23 14 * 10-12,1-3 1', $$select public.gh_dispatch('yoenis-yahoo.yml')$$);
select cron.schedule('gh-yoenis-yahoo-2', '43 14 * 4-9 *', $$select public.gh_dispatch('yoenis-yahoo.yml')$$);
select cron.schedule('gh-yoenis-yahoo-3', '43 3 * 4-10 *', $$select public.gh_dispatch('yoenis-yahoo.yml')$$);
