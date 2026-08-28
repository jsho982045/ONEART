-- ONEART — initial schema
--
-- Core rule: every account gets exactly ONE splat, ever. Enforced by
--   (a) UNIQUE (user_id) on public.splats, and
--   (b) the place_splat() RPC, which performs the check + insert + counters
--       atomically in a single transaction.
--
-- Safety design: a splat's appearance (colour, shape, size, rotation) is derived
-- ENTIRELY from `seed`, and `seed` is generated server-side inside place_splat().
-- The client only ever chooses x/y. It cannot influence or predict how its mark
-- looks. Never add a code path that lets the client supply appearance data.
--
-- Coordinates are normalised to [0,1] so the render-time world size can change
-- without a migration. Keep in sync with src/lib/canvas/constants.ts.
--
-- RLS: public SELECT on profiles / splats / canvas_meta. No client INSERT/UPDATE/
-- DELETE anywhere — all writes go through SECURITY DEFINER functions. The project
-- is configured with "auto expose new tables" OFF, so privileges are granted
-- explicitly at the end of this file.

-- =========================================================================
-- Enums
-- =========================================================================
create type public.canvas_status as enum ('open', 'paused', 'closed');

-- =========================================================================
-- disposable_domains — throwaway email providers blocked at signup
-- =========================================================================
create table public.disposable_domains (
  domain text primary key
);
comment on table public.disposable_domains is
  'Email domains rejected by handle_new_user(). Seed list is a starting point; extend as needed.';

insert into public.disposable_domains (domain) values
  ('0-mail.com'), ('10minutemail.com'), ('20minutemail.com'), ('33mail.com'),
  ('anonbox.net'), ('anonymbox.com'), ('boun.cr'), ('bugmenot.com'),
  ('burnermail.io'), ('byom.de'), ('crazymailing.com'), ('dispostable.com'),
  ('dropmail.me'), ('emailondeck.com'), ('emailtemporanea.com'), ('fakeinbox.com'),
  ('fakemail.net'), ('fakemailgenerator.com'), ('gettempmail.com'), ('getairmail.com'),
  ('getnada.com'), ('guerrillamail.com'), ('guerrillamail.biz'), ('guerrillamail.de'),
  ('guerrillamail.net'), ('guerrillamail.org'), ('harakirimail.com'), ('inboxbear.com'),
  ('inboxkitten.com'), ('jetable.org'), ('mailcatch.com'), ('maildrop.cc'),
  ('maileater.com'), ('mailexpire.com'), ('mailforspam.com'), ('mailinator.com'),
  ('mailinator.net'), ('mailnesia.com'), ('mailnull.com'), ('mailsac.com'),
  ('mailtemp.info'), ('mailtothis.com'), ('meltmail.com'), ('mintemail.com'),
  ('mohmal.com'), ('moakt.com'), ('mytemp.email'), ('mytrashmail.com'),
  ('nada.email'), ('no-spam.ws'), ('nowmymail.com'), ('objectmail.com'),
  ('one-time.email'), ('onewaymail.com'), ('owlymail.com'), ('put2.net'),
  ('rtrtr.com'), ('sharklasers.com'), ('shieldemail.com'), ('spam4.me'),
  ('spamgourmet.com'), ('spambox.us'), ('tempail.com'), ('tempinbox.com'),
  ('tempmail.com'), ('tempmail.net'), ('tempmailo.com'), ('temp-mail.org'),
  ('temp-mail.io'), ('tempr.email'), ('throwawaymail.com'), ('trashmail.com'),
  ('trashmail.de'), ('trashmail.net'), ('trash-mail.com'), ('wegwerfmail.de'),
  ('yopmail.com'), ('yopmail.fr'), ('yopmail.net');

-- =========================================================================
-- profiles — one row per auth user
-- =========================================================================
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  -- Always stored lowercase (see regex), so uniqueness is case-insensitive
  -- without needing citext. NULL until chosen: OAuth users pick one at
  -- /onboarding; place_splat() refuses to run while it is NULL.
  username    text unique
                check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  has_clicked boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth user, created by handle_new_user() on signup.';

-- =========================================================================
-- splats — the marks on the canvas (max one per user)
-- =========================================================================
create table public.splats (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references public.profiles (id) on delete cascade,
  -- normalised canvas coordinates, [0,1]; multiply by world size at render time
  x              double precision not null check (x >= 0 and x <= 1),
  y              double precision not null check (y >= 0 and y <= 1),
  -- 32-bit unsigned; the ONLY source of truth for appearance. Rendering always
  -- calls generateSplat(seed); it never trusts the cache columns below.
  seed           bigint not null check (seed >= 0 and seed <= 4294967295),
  -- Denormalised render cache. Nullable and unused in v1. May be backfilled
  -- later (e.g. by an Edge Function running the shared generateSplat) if
  -- analytics need queryable appearance data. NEVER read for rendering.
  vertex_count   integer,
  radius_offsets jsonb,
  base_color     text,
  size           double precision,
  rotation       double precision,
  created_at     timestamptz not null default now()
);
comment on column public.splats.seed is
  'Server-generated in place_splat(). generateSplat(seed) fully determines colour/shape/size/rotation.';

-- Viewport queries filter on x and y ranges independently.
create index splats_x_idx on public.splats (x);
create index splats_y_idx on public.splats (y);
-- "Find my splat" and one-per-user lookups.
-- (user_id already has a unique index from the UNIQUE constraint.)

-- =========================================================================
-- canvas_meta — singleton project state
-- =========================================================================
create table public.canvas_meta (
  id           boolean primary key default true check (id),
  total_clicks bigint not null default 0,
  status       public.canvas_status not null default 'open',
  closes_at    timestamptz,
  max_splats   bigint default 100000,
  updated_at   timestamptz not null default now()
);
comment on table public.canvas_meta is 'Exactly one row (id = true). total_clicks is maintained by place_splat().';

insert into public.canvas_meta (id) values (true);

-- Full row in realtime UPDATE payloads (one row, so the cost is negligible).
alter table public.canvas_meta replica identity full;

-- =========================================================================
-- handle_new_user — profile creation + disposable-email block on signup
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain   text := lower(split_part(coalesce(new.email, ''), '@', 2));
  v_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
begin
  if v_domain <> ''
     and exists (select 1 from public.disposable_domains d where d.domain = v_domain) then
    raise exception 'disposable_email_not_allowed';
  end if;

  -- Ignore anything that isn't a valid username; the user sets one at onboarding.
  if v_username = '' or v_username !~ '^[a-z0-9_]{3,20}$' then
    v_username := null;
  end if;

  begin
    insert into public.profiles (id, username) values (new.id, v_username);
  exception when unique_violation then
    -- username already taken (or profile already exists): fall back to no username
    insert into public.profiles (id, username)
    values (new.id, null)
    on conflict (id) do nothing;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- is_username_available — cheap check for live signup / onboarding feedback
-- =========================================================================
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    lower(trim(p_username)) ~ '^[a-z0-9_]{3,20}$'
    and not exists (
      select 1 from public.profiles p
      where p.username = lower(trim(p_username))
    );
$$;

-- =========================================================================
-- set_username — one-time username assignment (used by /onboarding)
-- =========================================================================
create or replace function public.set_username(p_username text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_clean text := lower(trim(p_username));
  v_row   public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if v_clean !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_username_format';
  end if;

  if v_clean = any (array[
    'admin','administrator','root','api','oneart','one_art','support','help',
    'about','login','logout','signup','signin','register','canvas','onboarding',
    'moderator','mod','staff','official','system','null','undefined','anonymous',
    'skyline','skylineavenue'
  ]) then
    raise exception 'username_reserved';
  end if;

  update public.profiles
     set username = v_clean
   where id = v_uid
     and username is null          -- settable only once, while unset
  returning * into v_row;

  if not found then
    raise exception 'username_already_set';
  end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'username_taken';
end;
$$;

-- =========================================================================
-- place_splat — THE one-click primitive. Atomic: verify eligibility, generate
-- the seed server-side, insert the splat, flip has_clicked, bump the counter.
-- =========================================================================
create or replace function public.place_splat(p_x double precision, p_y double precision)
returns public.splats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid              uuid := (select auth.uid());
  v_email_confirmed  timestamptz;
  v_profile          public.profiles;
  v_meta             public.canvas_meta;
  v_seed             bigint;
  v_row              public.splats;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Email must be verified (OAuth emails are pre-verified by the provider).
  select u.email_confirmed_at into v_email_confirmed
    from auth.users u where u.id = v_uid;
  if v_email_confirmed is null then
    raise exception 'email_not_verified';
  end if;

  -- Lock the caller's profile row for the duration of the transaction.
  select * into v_profile from public.profiles where id = v_uid for update;
  if v_profile.id is null then
    raise exception 'profile_missing';
  end if;
  if v_profile.username is null then
    raise exception 'username_required';
  end if;
  if v_profile.has_clicked then
    raise exception 'already_clicked';
  end if;

  -- Lock + read the singleton canvas state.
  select * into v_meta from public.canvas_meta where id = true for update;
  if v_meta.status <> 'open' then
    raise exception 'canvas_not_open';
  end if;
  if v_meta.closes_at is not null and now() >= v_meta.closes_at then
    raise exception 'canvas_closed';
  end if;
  if v_meta.max_splats is not null and v_meta.total_clicks >= v_meta.max_splats then
    raise exception 'canvas_full';
  end if;

  if p_x is null or p_y is null
     or p_x < 0 or p_x > 1 or p_y < 0 or p_y > 1 then
    raise exception 'coordinates_out_of_bounds';
  end if;

  -- Server-generated seed in [0, 2^32-1]. The user cannot choose or predict it.
  v_seed := floor(random() * 4294967296)::bigint;

  insert into public.splats (user_id, x, y, seed)
  values (v_uid, p_x, p_y, v_seed)
  returning * into v_row;

  update public.profiles set has_clicked = true where id = v_uid;

  update public.canvas_meta
     set total_clicks = total_clicks + 1,
         updated_at   = now()
   where id = true;

  return v_row;
exception
  when unique_violation then
    -- Race: a concurrent call already inserted this user's splat.
    raise exception 'already_clicked';
end;
$$;

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.profiles           enable row level security;
alter table public.splats             enable row level security;
alter table public.canvas_meta        enable row level security;
alter table public.disposable_domains enable row level security;

-- Public read. No write policies => clients cannot INSERT/UPDATE/DELETE.
create policy "profiles are readable by everyone"
  on public.profiles for select using (true);

create policy "splats are readable by everyone"
  on public.splats for select using (true);

create policy "canvas_meta is readable by everyone"
  on public.canvas_meta for select using (true);

-- disposable_domains: RLS on, zero policies => not readable by anon/authenticated
-- at all (only used server-side inside handle_new_user()).

-- =========================================================================
-- Privileges (explicit, because auto-expose-new-tables is OFF)
-- =========================================================================
grant usage on schema public to anon, authenticated;

grant select on public.profiles    to anon, authenticated;
grant select on public.splats      to anon, authenticated;
grant select on public.canvas_meta to anon, authenticated;
-- disposable_domains: no grants.

revoke all on function public.place_splat(double precision, double precision) from public;
revoke all on function public.set_username(text)                              from public;
revoke all on function public.is_username_available(text)                     from public;

grant execute on function public.place_splat(double precision, double precision) to authenticated;
grant execute on function public.set_username(text)                              to authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- =========================================================================
-- Realtime
-- =========================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'canvas_meta'
  ) then
    alter publication supabase_realtime add table public.canvas_meta;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'splats'
  ) then
    alter publication supabase_realtime add table public.splats;
  end if;
end $$;
