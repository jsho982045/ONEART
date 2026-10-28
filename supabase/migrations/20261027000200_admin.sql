-- ONEART: admin tools for scheduling canvases. Admins are set by hand:
--   update public.profiles set is_admin = true where lower(username) = lower('your_name');

create or replace function public.admin_save_canvas(
  p_id                 uuid,
  p_slug               text,
  p_title              text,
  p_opens_at           timestamptz,
  p_closes_at          timestamptz,
  p_ink_capacity       double precision,
  p_ink_refill_seconds integer
)
returns public.canvases
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.canvases;
begin
  perform public._require_admin();
  if p_id is null then
    insert into public.canvases (slug, title, width, height, opens_at, closes_at, ink_capacity, ink_refill_seconds)
    values (p_slug, p_title, 12000, 8000, p_opens_at, p_closes_at, p_ink_capacity, p_ink_refill_seconds)
    returning * into v;
  else
    -- Size can't change once people have painted; everything else can.
    update public.canvases
       set slug = p_slug, title = p_title, opens_at = p_opens_at, closes_at = p_closes_at,
           ink_capacity = p_ink_capacity, ink_refill_seconds = p_ink_refill_seconds
     where id = p_id
     returning * into v;
    if not found then raise exception 'not_found'; end if;
  end if;
  return v;
end;
$$;

revoke all on function public.admin_save_canvas(uuid, text, text, timestamptz, timestamptz, double precision, integer) from public, anon, authenticated;
grant execute on function public.admin_save_canvas(uuid, text, text, timestamptz, timestamptz, double precision, integer) to authenticated;

------------------------------------------------------------------------------------------------
-- Names nobody may use: impersonating the site or its moderators. Add offensive words here too
-- (from the SQL editor) rather than in git:  insert into public.blocked_name_words values ('...');
------------------------------------------------------------------------------------------------

create table public.blocked_name_words (
  word text primary key check (word = lower(word) and char_length(word) between 3 and 20)
);
alter table public.blocked_name_words enable row level security;
revoke all on public.blocked_name_words from anon, authenticated;

insert into public.blocked_name_words (word) values
  ('admin'), ('moderator'), ('oneart'), ('official'), ('support'), ('skyline'), ('staff')
on conflict do nothing;

create or replace function public._name_blocked(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.blocked_name_words w where strpos(lower(p_username), w.word) > 0);
$$;
revoke all on function public._name_blocked(text) from public, anon, authenticated;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_username ~ '^[A-Za-z0-9_]{3,20}$'
     and not public._name_blocked(p_username)
     and not exists (select 1 from public.profiles where lower(username) = lower(p_username));
$$;

-- A blocked name chosen at signup quietly becomes a placeholder (the person picks again on /welcome);
-- choosing one later is refused.
create or replace function public._guard_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._name_blocked(new.username) then
    if tg_op = 'INSERT' then
      new.username := 'artist_' || substr(md5(random()::text || new.id::text), 1, 8);
      new.onboarded := false;
      new.accepted_terms_at := null;
      new.age_confirmed_at := null;
    else
      raise exception 'username_taken';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_username before insert or update of username on public.profiles
  for each row execute function public._guard_username();
