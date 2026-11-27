-- Site health: browser errors, problem reports and the public status page.
--   site_error(p)            a page's uncaught error (assets/navigation.js sends them): one row per distinct error an
--                            hour, counted up after that; at most 300 new rows an hour in all
--   site_report(...)         "Report a problem" (davidsolar.dev/status/): kept, and emailed to the site's owner by the
--                            league clock (fk-clock) within five minutes
--   site_health()            what the status page shows: each live feed's last update, the scheduler's last runs, and
--                            when the scheduler last started each data job, and how many errors and reports came in the last day (counts only, nothing anyone typed)
--   site_admin_take(token)   for fk-clock: unsent reports, and once a day a digest of new errors, with the address to
--                            send them to (site_config admin_email, set in the database, not in the repo)
-- Run after fantasykit_supabase.sql (fk_token_ok) and gh_scheduler.sql.

create table if not exists public.site_config (key text primary key, value text not null);
alter table public.site_config enable row level security;
revoke all on public.site_config from anon, authenticated;

create table if not exists public.site_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  page text not null, msg text not null, src text, line int, stack text, ua text,
  n int not null default 1,
  digested boolean not null default false
);
create index if not exists site_errors_at on public.site_errors (at desc);
alter table public.site_errors enable row level security;
revoke all on public.site_errors from anon, authenticated;

create table if not exists public.site_reports (
  id bigserial primary key,
  at timestamptz not null default now(),
  page text, body text not null, contact text, user_id uuid, ua text,
  sent_at timestamptz
);
alter table public.site_reports enable row level security;
revoke all on public.site_reports from anon, authenticated;

create or replace function public.site_error(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pg text := left(coalesce(p->>'page', ''), 200); m text := left(coalesce(p->>'msg', ''), 400); s text := left(coalesce(p->>'src', ''), 300);
  ln int := case when (p->>'line') ~ '^\d{1,7}$' then (p->>'line')::int else null end; hit bigint;
begin
  if m = '' then return jsonb_build_object('ok', false); end if;
  select id into hit from site_errors where msg = m and coalesce(src, '') = s and coalesce(line, -1) = coalesce(ln, -1) and page = pg and last_at > now() - interval '1 hour' order by id desc limit 1;
  if hit is not null then update site_errors set n = n + 1, last_at = now() where id = hit; return jsonb_build_object('ok', true); end if;
  if (select count(*) from site_errors where at > now() - interval '1 hour') >= 300 then return jsonb_build_object('ok', false); end if;
  insert into site_errors (page, msg, src, line, stack, ua) values (pg, m, nullif(s, ''), ln, left(p->>'stack', 2000), left(p->>'ua', 300));
  delete from site_errors where at < now() - interval '60 days';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.site_report(p_page text, p_body text, p_contact text default null, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := btrim(left(coalesce(p_body, ''), 3000));
begin
  if length(b) < 3 then return jsonb_build_object('error', 'Say what went wrong first.'); end if;
  if (select count(*) from site_reports where at > now() - interval '1 hour') >= 30 then return jsonb_build_object('error', 'Too many reports right now. Try again in a little while.'); end if;
  insert into site_reports (page, body, contact, user_id, ua) values (left(p_page, 300), b, nullif(btrim(left(coalesce(p_contact, ''), 200)), ''), auth.uid(), left(p_ua, 300));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.site_health() returns jsonb
language sql stable security definer set search_path = public, cron as $$
  select jsonb_build_object(
    'now', (extract(epoch from now()) * 1000)::bigint,
    'live', (select coalesce(jsonb_object_agg(sport, jsonb_build_object('at', (extract(epoch from updated_at) * 1000)::bigint,
        'on', exists (select 1 from jsonb_each(coalesce(data->'teams', '{}'::jsonb)) t where (t.value->>'live') ~ '^\d+$' and (t.value->>'live')::int > 0))), '{}'::jsonb) from fk_live),
    'clock', (select (extract(epoch from max(end_time)) * 1000)::bigint from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.command ilike '%fk-clock%' and d.status = 'succeeded' and d.end_time > now() - interval '1 day'),
    'jobs', (select coalesce(jsonb_object_agg(workflow, (extract(epoch from at) * 1000)::bigint), '{}'::jsonb) from (
        select workflow, max(at) as at from gh_dispatch_log where at > now() - interval '7 days' group by workflow) x),
    'errors', (select coalesce(sum(n), 0) from site_errors where last_at > now() - interval '1 day'),
    'reports', (select count(*) from site_reports where at > now() - interval '1 day'));
$$;

create or replace function public.site_admin_take(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare to_ text; rep jsonb; dig jsonb := null; et timestamp := now() at time zone 'America/New_York';
begin
  if not fk_token_ok(p_token) then return jsonb_build_object('error', 'no'); end if;
  select value into to_ from site_config where key = 'admin_email';
  if to_ is null then return jsonb_build_object('error', 'no admin_email'); end if;
  with s as (update site_reports set sent_at = now() where sent_at is null and id in (select id from site_reports where sent_at is null order by id limit 20) returning *)
  select coalesce(jsonb_agg(jsonb_build_object('at', at, 'page', page, 'body', body, 'contact', contact, 'signed', user_id is not null) order by id), '[]'::jsonb) into rep from s;
  -- the error digest: once a day, from 8 a.m. Eastern, when anything new came in
  if extract(hour from et) >= 8 and not exists (select 1 from site_config where key = 'digest_day' and value = to_char(et, 'YYYY-MM-DD')) then
    with e as (update site_errors set digested = true where not digested returning *)
    select jsonb_agg(jsonb_build_object('page', page, 'msg', msg, 'src', src, 'line', line, 'n', n, 'at', at) order by n desc) into dig from e;
    insert into site_config (key, value) values ('digest_day', to_char(et, 'YYYY-MM-DD')) on conflict (key) do update set value = excluded.value;
  end if;
  return jsonb_build_object('to', to_, 'reports', rep, 'errors', dig);
end $$;

revoke all on function public.site_admin_take(text) from public, authenticated;
grant execute on function public.site_admin_take(text) to anon;   -- the clock, with its token
grant execute on function public.site_error(jsonb), public.site_report(text, text, text, text), public.site_health() to anon, authenticated;

-- the address the reports go to: the site owner's account (the Wipe Yoenis commissioner), not written in the repo
insert into public.site_config (key, value)
  select 'admin_email', u.email from auth.users u join fk_leagues l on l.commish = u.id where l.id = 'yoenis' and u.email is not null
  on conflict (key) do nothing;
