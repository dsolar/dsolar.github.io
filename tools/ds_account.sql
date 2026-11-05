-- The account page (account/index.html): what's on your account, and deleting it.
-- Applied to Supabase as the migration ds_account_page. Both are granted to authenticated users.

CREATE OR REPLACE FUNCTION public.ds_account_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare uid uuid := auth.uid(); u auth.users; un text; p fk_profiles; nl int; nc int; ns int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select * into u from auth.users where id = uid;
  select username into un from fk_usernames where user_id = uid;
  select * into p from fk_profiles where user_id = uid;
  select count(*) into nl from fk_seats where user_id = uid;
  select count(*) into nc from fk_leagues where commish = uid;
  select count(*) into ns from ds_sync where user_id = uid;
  return jsonb_build_object('ok', true, 'email', u.email, 'username', un, 'name', p.name, 'photo', p.photo,
    'google', exists (select 1 from auth.identities where user_id = uid and provider = 'google'),
    'password', u.encrypted_password is not null and u.encrypted_password <> '',
    'since', u.created_at, 'leagues', nl, 'commish', nc, 'saves', ns);
end $function$;

-- Leagues you run pass to the manager who joined earliest; a league with nobody else in it is deleted.
-- Your seats become open teams (bots), and deleting the auth user takes your profile, username and game saves.
CREATE OR REPLACE FUNCTION public.ds_account_delete(p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare uid uuid := auth.uid(); l record; heir uuid; mail text;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if p_confirm is distinct from 'DELETE' then return jsonb_build_object('error', 'Type DELETE to confirm.'); end if;
  select email into mail from auth.users where id = uid;
  for l in select id from fk_leagues where commish = uid loop
    select user_id into heir from fk_seats where league = l.id and user_id <> uid order by joined_at asc limit 1;
    if heir is not null then
      update fk_leagues set commish = heir, version = version + 1, updated_at = now() where id = l.id;
    else
      delete from fk_posts where league = l.id; delete from fk_sealed where league = l.id; delete from fk_heist where league = l.id;
      delete from fk_outbox where league = l.id; delete from fk_seats where league = l.id; delete from fk_leagues where id = l.id;
    end if;
  end loop;
  update fk_leagues set version = version + 1, updated_at = now() where id in (select league from fk_seats where user_id = uid);
  delete from fk_seats where user_id = uid;
  delete from auth.users where id = uid;
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.ds_account_me() from public, anon;
revoke all on function public.ds_account_delete(text) from public, anon;
grant execute on function public.ds_account_me() to authenticated;
grant execute on function public.ds_account_delete(text) to authenticated;
