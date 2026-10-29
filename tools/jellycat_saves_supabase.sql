-- Cloud saves for Jellycat Battle Club (davidsolar.dev/jellycat-battle/). A save is keyed by a
-- kid-friendly code like BUNNY-PEAR-MOON-42: whoever has the code can load and update that save,
-- so progress can move between the iPad and the laptop with no account or email.
-- Same lockdown as the other games: the table is closed to the browser, which can only call the
-- three functions below. Already set up; safe to run again.
create table if not exists public.jbc_saves (
  code text primary key check (code ~ '^[A-Z]{3,8}-[A-Z]{3,8}-[A-Z]{3,8}-[0-9]{2}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 262144),
  saved_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jbc_saves_created on public.jbc_saves (created_at);
alter table public.jbc_saves enable row level security;
revoke all on public.jbc_saves from anon, authenticated;

-- Mints a fresh code and stores the first copy of the save with it.
create or replace function public.jbc_new(p_data jsonb, p_saved_at timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  words text[] := array['BUNNY','BEAR','PEAR','MOON','STAR','CLOUD','HONEY','MAPLE','PEACH','PLUM','BERRY','MANGO',
    'LEMON','OTTER','PANDA','KOALA','FOX','OWL','DUCK','FROG','SNAIL','BEE','WHALE','SEAL','TOAST','BAGEL','CAKE',
    'COOKIE','MUFFIN','TACO','PICKLE','ACORN','TULIP','DAISY','POPPY','FERN','MOSS','PEBBLE','SHELL','PEARL','RIVER',
    'MEADOW','BREEZE','SUNNY','RAINY','SNOWY','COZY','FUZZY','SILLY','HAPPY','JOLLY','BRAVE','SWIFT','TINY','MIGHTY',
    'COMET','ROCKET','KITE','BOAT','DRUM','FLUTE','BELL','BUTTON','RIBBON'];
  n int := array_length(words, 1);
  b bytea;
  c text;
  tries int := 0;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) >= 262144 then
    raise exception 'bad save';
  end if;
  -- Simple flood guard for a public endpoint.
  if (select count(*) from public.jbc_saves where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too many new saves right now, try again later';
  end if;
  loop
    tries := tries + 1;
    b := extensions.gen_random_bytes(4);
    c := words[1 + get_byte(b, 0) % n] || '-' || words[1 + get_byte(b, 1) % n] || '-' || words[1 + get_byte(b, 2) % n]
         || '-' || lpad((get_byte(b, 3) % 100)::text, 2, '0');
    begin
      insert into public.jbc_saves (code, data, saved_at) values (c, p_data, least(coalesce(p_saved_at, now()), now()));
      return c;
    exception when unique_violation then
      if tries > 8 then raise; end if;
    end;
  end loop;
end;
$$;

-- Stores a newer copy. Newest save wins: an older copy never overwrites a newer one.
-- Returns the save time the server now holds, so the browser can tell if another device is ahead.
create or replace function public.jbc_put(p_code text, p_data jsonb, p_saved_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  held timestamptz;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) >= 262144 then
    raise exception 'bad save';
  end if;
  update public.jbc_saves
     set data = p_data, saved_at = least(p_saved_at, now()), updated_at = now()
   where code = upper(btrim(p_code)) and saved_at < least(p_saved_at, now());
  select saved_at into held from public.jbc_saves where code = upper(btrim(p_code));
  if held is null then
    raise exception 'save code not found';
  end if;
  return held;
end;
$$;

create or replace function public.jbc_get(p_code text)
returns table (data jsonb, saved_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.data, s.saved_at from public.jbc_saves s where s.code = upper(btrim(p_code));
$$;

revoke all on function public.jbc_new(jsonb, timestamptz) from public;
revoke all on function public.jbc_put(text, jsonb, timestamptz) from public;
revoke all on function public.jbc_get(text) from public;
grant execute on function public.jbc_new(jsonb, timestamptz) to anon, authenticated;
grant execute on function public.jbc_put(text, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.jbc_get(text) to anon, authenticated;
