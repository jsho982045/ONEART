-- ONEART initial schema
--
-- Design rules enforced here, in the database, so no client bug can break them:
--   1. One mark per person. splat_owners.user_id is UNIQUE and place_splat() checks has_clicked
--      under a row lock, so double-clicks and parallel requests cannot create two splats.
--   2. Users never control appearance. place_splat() only accepts x and y. The random seed is
--      generated here, in Postgres. src/lib/splat.ts derives shape/size/color from that seed.
--   3. Public data can't be tied to people. `splats` (public) holds only position + seed. The link to an
--      account lives in `splat_owners`, which the API cannot read directly.
--   4. The browser can't write to any table. All writes go through SECURITY DEFINER functions.
--
-- WORLD_SIZE is 5000. Keep in sync with src/lib/constants.ts.
--
-- Apply to the DEV project first (oneart-dev). Never run against prod without a deliberate go-ahead.

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------

create table public.blocked_email_domains (
  domain text primary key
);

insert into public.blocked_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'),
  ('guerrillamailblock.com'), ('sharklasers.com'), ('grr.la'), ('10minutemail.com'),
  ('10minutemail.net'), ('tempmail.com'), ('temp-mail.org'), ('temp-mail.io'), ('tempmail.net'),
  ('throwawaymail.com'), ('yopmail.com'), ('yopmail.net'), ('yopmail.fr'), ('trashmail.com'),
  ('trashmail.net'), ('getnada.com'), ('nada.email'), ('maildrop.cc'), ('dispostable.com'),
  ('fakeinbox.com'), ('mailnesia.com'), ('mintemail.com'), ('mohmal.com'), ('emailondeck.com'),
  ('spamgourmet.com'), ('spam4.me'), ('tempinbox.com'), ('burnermail.io'), ('discard.email'),
  ('discardmail.com'), ('moakt.com'), ('tmail.ws'), ('tmpmail.org'), ('tmpmail.net'),
  ('mailcatch.com'), ('mytemp.email'), ('inboxkitten.com'), ('emailfake.com'), ('fakemail.net'),
  ('mail.tm'), ('harakirimail.com'), ('jetable.org'), ('mailforspam.com'), ('tempr.email'),
  ('minuteinbox.com'), ('anonbox.net'), ('owlymail.com')
on conflict do nothing;

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  username          text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  onboarded         boolean not null default false,
  accepted_terms_at timestamptz,
  age_confirmed_at  timestamptz,
  has_clicked       boolean not null default false,
  created_at        timestamptz not null default now()
);

create unique index profiles_username_lower_key on public.profiles (lower(username));

-- The public artwork data. Nothing in here identifies a person.
create table public.splats (
  id           uuid primary key default gen_random_uuid(),
  x            double precision not null check (x >= 0 and x <= 5000),
  y            double precision not null check (y >= 0 and y <= 5000),
  seed         bigint not null check (seed >= 0 and seed < 4294967296),
  algo_version smallint not null default 1,
  created_at   timestamptz not null default now()
);

create index splats_x_y_idx on public.splats (x, y);
create index splats_created_at_idx on public.splats (created_at, id);

-- Who placed which splat. Not readable through the API.
-- user_id becomes NULL if the account is deleted, so the splat stays but is anonymous.
create table public.splat_owners (
  splat_id uuid primary key references public.splats (id) on delete cascade,
  user_id  uuid unique references public.profiles (id) on delete set null
);

create table public.canvas_meta (
  id           smallint primary key default 1 check (id = 1),
  total_clicks bigint not null default 0,
  status       text not null default 'active' check (status in ('active', 'closed', 'sold')),
  closes_at    timestamptz,
  max_splats   bigint
);

insert into public.canvas_meta (id) values (1) on conflict do nothing;

------------------------------------------------------------------------------------------------
-- Row Level Security + privileges
------------------------------------------------------------------------------------------------

alter table public.blocked_email_domains enable row level security;
alter table public.profiles              enable row level security;
alter table public.splats                enable row level security;
alter table public.splat_owners          enable row level security;
alter table public.canvas_meta           enable row level security;

-- Start from nothing, then grant back only what the app needs.
revoke all on public.blocked_email_domains from anon, authenticated;
revoke all on public.profiles              from anon, authenticated;
revoke all on public.splats                from anon, authenticated;
revoke all on public.splat_owners          from anon, authenticated;
revoke all on public.canvas_meta           from anon, authenticated;

grant select on public.splats      to anon, authenticated;
grant select on public.canvas_meta to anon, authenticated;

create policy "splats are public"      on public.splats      for select to anon, authenticated using (true);
create policy "canvas meta is public"  on public.canvas_meta for select to anon, authenticated using (true);
-- No insert/update/delete policies anywhere: only the functions below can write.

------------------------------------------------------------------------------------------------
-- New-user trigger
------------------------------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain     text := lower(split_part(coalesce(new.email, ''), '@', 2));
  v_username   text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');
  v_terms      boolean := coalesce(new.raw_user_meta_data ->> 'terms_accepted', '') = 'true';
  v_age        boolean := coalesce(new.raw_user_meta_data ->> 'age_confirmed', '') = 'true';
  v_onboarded  boolean := false;
begin
  if exists (select 1 from public.blocked_email_domains where domain = v_domain) then
    raise exception 'disposable_email_not_allowed';
  end if;

  -- Email/password signups arrive with username + consent in metadata and are onboarded immediately.
  -- OAuth signups (Google) don't, so they get a placeholder name and finish on /welcome.
  if v_username is not null
     and v_username ~ '^[A-Za-z0-9_]{3,20}$'
     and v_terms and v_age
     and not exists (select 1 from public.profiles where lower(username) = lower(v_username)) then
    v_onboarded := true;
  else
    v_username := 'artist_' || substr(md5(random()::text || new.id::text), 1, 8);
  end if;

  insert into public.profiles (id, username, onboarded, accepted_terms_at, age_confirmed_at)
  values (
    new.id,
    v_username,
    v_onboarded,
    case when v_onboarded then now() end,
    case when v_onboarded then now() end
  );

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------------------------------------------
-- Functions the app calls
------------------------------------------------------------------------------------------------

-- Finish signup for people who came in through Google (or any account that isn't onboarded yet).
create or replace function public.complete_onboarding(
  p_username text,
  p_accept_terms boolean,
  p_confirm_age boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not coalesce(p_accept_terms, false) or not coalesce(p_confirm_age, false) then
    raise exception 'consent_required';
  end if;
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'invalid_username';
  end if;

  update public.profiles
     set username = p_username,
         onboarded = true,
         accepted_terms_at = now(),
         age_confirmed_at = now()
   where id = v_uid and onboarded = false;

  if not found then raise exception 'already_onboarded'; end if;
exception
  when unique_violation then
    raise exception 'username_taken';
end;
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_username ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(p_username));
$$;

-- The logged-in user's own state. Returns null when logged out.
create or replace function public.my_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id',        p.id,
    'username',       p.username,
    'onboarded',      p.onboarded,
    'has_clicked',    p.has_clicked,
    'email_verified', coalesce((select u.email_confirmed_at is not null from auth.users u where u.id = p.id), false),
    'splat',          (select to_jsonb(s) from public.splats s
                         join public.splat_owners o on o.splat_id = s.id
                        where o.user_id = p.id)
  )
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Hover/tap info for a splat: who made it and when.
create or replace function public.splat_owner(p_splat_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('username', p.username, 'created_at', s.created_at)
    from public.splats s
    left join public.splat_owners o on o.splat_id = s.id
    left join public.profiles p on p.id = o.user_id
   where s.id = p_splat_id;
$$;

-- Deep links: /canvas?u=username
create or replace function public.splat_by_username(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(s)
    from public.profiles p
    join public.splat_owners o on o.user_id = p.id
    join public.splats s on s.id = o.splat_id
   where lower(p.username) = lower(p_username);
$$;

-- THE one-click rule. The only way to create a splat.
create or replace function public.place_splat(p_x double precision, p_y double precision)
returns public.splats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_verified  timestamptz;
  v_profile   public.profiles;
  v_splat     public.splats;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select email_confirmed_at into v_verified from auth.users where id = v_uid;
  if v_verified is null then raise exception 'email_not_verified'; end if;

  -- Row lock: concurrent requests from the same user queue up here, and the second one sees has_clicked = true.
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or not v_profile.onboarded then raise exception 'not_onboarded'; end if;
  if v_profile.has_clicked then raise exception 'already_placed'; end if;

  -- NaN compares greater than every number in Postgres, so it fails this check too.
  if p_x is null or p_y is null or p_x < 0 or p_x > 5000 or p_y < 0 or p_y > 5000 then
    raise exception 'out_of_bounds';
  end if;

  -- Claim a slot on the counter. Fails (and rolls everything back) if the canvas is closed or full.
  update public.canvas_meta
     set total_clicks = total_clicks + 1
   where id = 1
     and status = 'active'
     and (closes_at is null or closes_at > now())
     and (max_splats is null or total_clicks < max_splats);
  if not found then raise exception 'canvas_closed'; end if;

  insert into public.splats (x, y, seed)
  values (p_x, p_y, floor(random() * 4294967296)::bigint)
  returning * into v_splat;

  insert into public.splat_owners (splat_id, user_id) values (v_splat.id, v_uid);
  update public.profiles set has_clicked = true where id = v_uid;

  return v_splat;
end;
$$;

-- Lock down who may call what.
revoke all on function public.complete_onboarding(text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.username_available(text)                    from public, anon, authenticated;
revoke all on function public.my_state()                                  from public, anon, authenticated;
revoke all on function public.splat_owner(uuid)                           from public, anon, authenticated;
revoke all on function public.splat_by_username(text)                     from public, anon, authenticated;
revoke all on function public.place_splat(double precision, double precision) from public, anon, authenticated;

grant execute on function public.complete_onboarding(text, boolean, boolean) to authenticated;
grant execute on function public.my_state()                                  to anon, authenticated;
grant execute on function public.username_available(text)                    to anon, authenticated;
grant execute on function public.splat_owner(uuid)                           to anon, authenticated;
grant execute on function public.splat_by_username(text)                     to anon, authenticated;
grant execute on function public.place_splat(double precision, double precision) to authenticated;

------------------------------------------------------------------------------------------------
-- Realtime: live counter + splats appearing as they're placed
------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.splats;
    alter publication supabase_realtime add table public.canvas_meta;
  end if;
end;
$$;
