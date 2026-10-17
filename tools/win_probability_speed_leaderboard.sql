-- Public daily Speed Round scores for Make the Call.
-- One-time deployment: Supabase SQL Editor, or apply as the
-- wp_speed_round_leaderboard migration. The app only displays an optional
-- nickname, grade, score, and average answer time.

create table if not exists public.wp_speed_scores (
  id bigint generated always as identity primary key,
  challenge_date date not null,
  player_key uuid not null,
  nickname text not null check (nickname = btrim(nickname) and nickname ~ '^[A-Za-z0-9 ._-]{2,20}$'),
  score integer not null check (score between 0 and 1000),
  base_points integer not null check (base_points between 0 and 1000),
  average_seconds numeric(4,1) not null check (average_seconds between 0 and 25),
  grade text not null check (grade in ('A+', 'A', 'B', 'C', 'D', 'F')),
  submitted_at timestamptz not null default now(),
  unique (challenge_date, player_key)
);

create index if not exists wp_speed_scores_daily_rank
  on public.wp_speed_scores (challenge_date, score desc, average_seconds asc, submitted_at asc);

alter table public.wp_speed_scores enable row level security;

drop policy if exists wp_speed_scores_public_read on public.wp_speed_scores;
create policy wp_speed_scores_public_read
  on public.wp_speed_scores for select to anon using (true);

drop policy if exists wp_speed_scores_public_submit on public.wp_speed_scores;
create policy wp_speed_scores_public_submit
  on public.wp_speed_scores for insert to anon
  with check (
    challenge_date between current_date - 1 and current_date + 1
    and score between 0 and 1000
    and base_points between 0 and 1000
    and average_seconds between 0 and 25
    and grade in ('A+', 'A', 'B', 'C', 'D', 'F')
    and nickname = btrim(nickname)
    and nickname ~ '^[A-Za-z0-9 ._-]{2,20}$'
  );

revoke all on table public.wp_speed_scores from public, anon, authenticated;
grant select (challenge_date, nickname, score, base_points, average_seconds, grade, submitted_at)
  on table public.wp_speed_scores to anon;
grant insert (challenge_date, player_key, nickname, score, base_points, average_seconds, grade)
  on table public.wp_speed_scores to anon;
grant usage on schema public to anon;

do $$
declare sequence_name text;
begin
  sequence_name := pg_get_serial_sequence('public.wp_speed_scores', 'id');
  execute 'grant usage, select on sequence ' || sequence_name || ' to anon';
end
$$;

create or replace function public.wp_speed_leaderboard(p_challenge_date date)
returns table (
  nickname text,
  score integer,
  base_points integer,
  average_seconds numeric,
  grade text,
  submitted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.nickname, s.score, s.base_points, s.average_seconds, s.grade, s.submitted_at
  from public.wp_speed_scores as s
  where s.challenge_date = p_challenge_date
  order by s.score desc, s.average_seconds asc, s.submitted_at asc
  limit 20;
$$;

create or replace function public.wp_submit_speed_score(
  p_challenge_date date,
  p_player_key uuid,
  p_nickname text,
  p_score integer,
  p_base_points integer,
  p_average_seconds numeric,
  p_grade text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_challenge_date < current_date - 1 or p_challenge_date > current_date + 1 then
    raise exception 'Challenge date is not current';
  end if;

  begin
    insert into public.wp_speed_scores (
      challenge_date, player_key, nickname, score, base_points, average_seconds, grade
    ) values (
      p_challenge_date, p_player_key, btrim(p_nickname), p_score, p_base_points, p_average_seconds, p_grade
    );
    return true;
  exception when unique_violation then
    return false;
  end;
end;
$$;

revoke all on function public.wp_speed_leaderboard(date) from public;
revoke all on function public.wp_submit_speed_score(date, uuid, text, integer, integer, numeric, text) from public;
grant execute on function public.wp_speed_leaderboard(date) to anon;
grant execute on function public.wp_submit_speed_score(date, uuid, text, integer, integer, numeric, text) to anon;
