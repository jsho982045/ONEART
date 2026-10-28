-- ONEART v2: a shared freehand canvas.
--
-- Replaces the one-click "splat" model from 20261004000000_init.sql. Profiles, signup and onboarding stay.
--
-- Rules enforced here, so no client bug or modified browser can break them:
--   1. Only verified, onboarded, non-banned accounts can draw, and only while the canvas is open.
--   2. The browser can't write to any table. All writes go through SECURITY DEFINER functions.
--   3. Stroke geometry is decoded HERE: bounds, length and ink cost are computed by the database,
--      never trusted from the client. Encoding is documented in src/lib/paint/codec.ts.
--   4. The ink well (fair-use limit) is computed here. It refills continuously.
--   5. You can only erase your own strokes. Moderators can hide anything; hidden geometry is moved
--      to a private table so it can't be fetched.
--   6. "You can't paint over other people" is enforced by the renderer: every client (and the final
--      render) paints strokes in id order and clips each stroke against earlier strokes by other
--      artists. A modified client can only change what its own screen shows. See src/lib/paint/ownership.ts.
--
-- Apply to oneart-dev first. Never run against prod without a deliberate go-ahead.

------------------------------------------------------------------------------------------------
-- Remove the one-click model
------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'splats') then
      alter publication supabase_realtime drop table public.splats;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'canvas_meta') then
      alter publication supabase_realtime drop table public.canvas_meta;
    end if;
  end if;
end;
$$;

drop function if exists public.place_splat(double precision, double precision);
drop function if exists public.splat_owner(uuid);
drop function if exists public.splat_by_username(text);
drop function if exists public.my_state();
drop table if exists public.splat_owners;
drop table if exists public.splats;
drop table if exists public.canvas_meta;

alter table public.profiles drop column if exists has_clicked;

-- Public, opaque artist number. Strokes point at this, never at the auth user id.
alter table public.profiles add column artist_no bigint generated always as identity;
alter table public.profiles add constraint profiles_artist_no_key unique (artist_no);

alter table public.profiles
  add column ink           double precision,            -- null = full
  add column ink_at        timestamptz,
  add column is_admin      boolean not null default false,
  add column banned_at     timestamptz,
  add column rate_window   timestamptz,
  add column rate_count    integer not null default 0;

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------

create table public.canvases (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  title               text not null check (char_length(title) between 1 and 80),
  width               integer not null check (width between 1000 and 16000),
  height              integer not null check (height between 1000 and 16000),
  opens_at            timestamptz not null default now(),
  closes_at           timestamptz not null,
  ink_capacity        double precision not null default 800000 check (ink_capacity > 0),
  ink_refill_seconds  integer not null default 7200 check (ink_refill_seconds > 0),
  created_at          timestamptz not null default now(),
  check (closes_at > opens_at)
);

-- The first canvas. Set the real launch window before going live:
--   update public.canvases set opens_at = '...', closes_at = '...' where slug = 'first';
insert into public.canvases (slug, title, width, height, opens_at, closes_at)
values ('first', 'The first canvas', 12000, 8000, now(), now() + interval '30 days');

create table public.strokes (
  id          bigint generated always as identity primary key,
  canvas_id   uuid not null references public.canvases (id) on delete cascade,
  artist_no   bigint references public.profiles (artist_no) on delete set null,
  tool        text not null check (tool in ('pencil', 'ink', 'oil', 'watercolor', 'charcoal', 'text')),
  color       text not null check (color ~ '^#[0-9a-f]{6}$'),
  size        real not null check (size >= 0.5 and size <= 400),
  opacity     real not null check (opacity >= 0.05 and opacity <= 1),
  points      text not null,
  body        text check (body is null or char_length(body) between 1 and 200),
  font        text check (font is null or font in ('hand', 'serif', 'sans')),
  min_x       real not null,
  min_y       real not null,
  max_x       real not null,
  max_y       real not null,
  ink_cost    real not null,
  erased      boolean not null default false,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index strokes_canvas_order_idx on public.strokes (canvas_id, id);
create index strokes_canvas_x_idx on public.strokes (canvas_id, min_x, max_x);
create index strokes_artist_idx on public.strokes (artist_no);

-- Geometry of moderated strokes. Never readable through the API.
create table public.stroke_hidden (
  stroke_id   bigint primary key references public.strokes (id) on delete cascade,
  points      text not null,
  body        text,
  hidden_at   timestamptz not null default now(),
  hidden_by   uuid references public.profiles (id) on delete set null
);

create table public.reports (
  id           bigint generated always as identity primary key,
  stroke_id    bigint not null references public.strokes (id) on delete cascade,
  reporter     uuid references public.profiles (id) on delete set null,
  reason       text not null check (reason in ('hate', 'sexual', 'violence', 'spam', 'personal_info', 'other')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (stroke_id, reporter)
);

------------------------------------------------------------------------------------------------
-- Row Level Security + privileges
------------------------------------------------------------------------------------------------

alter table public.canvases      enable row level security;
alter table public.strokes       enable row level security;
alter table public.stroke_hidden enable row level security;
alter table public.reports       enable row level security;

revoke all on public.canvases      from anon, authenticated;
revoke all on public.strokes       from anon, authenticated;
revoke all on public.stroke_hidden from anon, authenticated;
revoke all on public.reports       from anon, authenticated;

grant select on public.canvases to anon, authenticated;
grant select on public.strokes  to anon, authenticated;

create policy "canvases are public" on public.canvases for select to anon, authenticated using (true);
-- Hidden strokes stay visible as rows (with empty geometry) so realtime can tell every viewer to remove them.
create policy "strokes are public"  on public.strokes  for select to anon, authenticated using (true);

------------------------------------------------------------------------------------------------
-- Internal helpers
------------------------------------------------------------------------------------------------

-- Ink balance right now, given the stored balance and the canvas refill settings.
create or replace function public._ink_balance(p_ink double precision, p_at timestamptz, p_cap double precision, p_refill integer)
returns double precision
language sql
stable
as $$
  select case
    when p_ink is null or p_at is null then p_cap
    else least(p_cap, p_ink + extract(epoch from (now() - p_at)) * p_cap / p_refill)
  end;
$$;
revoke all on function public._ink_balance(double precision, timestamptz, double precision, integer) from public, anon, authenticated;

create or replace function public._open_canvas(p_canvas uuid)
returns public.canvases
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.canvases;
begin
  select * into v from public.canvases where id = p_canvas;
  if not found then raise exception 'canvas_not_found'; end if;
  if now() < v.opens_at or now() >= v.closes_at then raise exception 'canvas_closed'; end if;
  return v;
end;
$$;
revoke all on function public._open_canvas(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- Functions the app calls
------------------------------------------------------------------------------------------------

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
    'artist_no',      p.artist_no,
    'onboarded',      p.onboarded,
    'is_admin',       p.is_admin,
    'banned',         p.banned_at is not null,
    'email_verified', coalesce((select u.email_confirmed_at is not null from auth.users u where u.id = p.id), false),
    'ink',            p.ink,
    'ink_at',         p.ink_at
  )
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Usernames for a batch of artist numbers (hover cards, live "is painting" labels).
create or replace function public.artist_names(p_artists bigint[])
returns table (artist_no bigint, username text)
language sql
stable
security definer
set search_path = public
as $$
  select p.artist_no, p.username
    from public.profiles p
   where p.artist_no = any (p_artists[1:500]);
$$;

create or replace function public.artist_by_username(p_username text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select artist_no from public.profiles where lower(username) = lower(p_username);
$$;

create or replace function public.canvas_stats(p_canvas uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'strokes', count(*) filter (where not erased and not hidden),
    'artists', count(distinct artist_no) filter (where not erased and not hidden)
  )
  from public.strokes
  where canvas_id = p_canvas;
$$;

-- THE way to paint. Geometry format (base64):
--   byte 0         version = 1
--   then per point: x uint16 LE, y uint16 LE (world units x 4), pressure uint8 (0..255)
-- Text strokes carry exactly one point: the baseline-left anchor.
create or replace function public.draw_stroke(
  p_canvas  uuid,
  p_tool    text,
  p_color   text,
  p_size    real,
  p_opacity real,
  p_points  text,
  p_body    text default null,
  p_font    text default null
)
returns public.strokes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles;
  v_canvas   public.canvases;
  v_bytes    bytea;
  v_n        integer;
  v_i        integer;
  v_off      integer;
  v_x        double precision;
  v_y        double precision;
  v_px       double precision;
  v_py       double precision;
  v_minx     double precision := 'infinity';
  v_miny     double precision := 'infinity';
  v_maxx     double precision := '-infinity';
  v_maxy     double precision := '-infinity';
  v_len      double precision := 0;
  v_pad      double precision;
  v_cost     double precision;
  v_balance  double precision;
  v_stroke   public.strokes;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    raise exception 'email_not_verified';
  end if;

  -- Row lock: one stroke at a time per person, so ink and rate limits can't be raced.
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or not v_profile.onboarded then raise exception 'not_onboarded'; end if;
  if v_profile.banned_at is not null then raise exception 'banned'; end if;

  v_canvas := public._open_canvas(p_canvas);

  if p_tool is null or p_tool not in ('pencil', 'ink', 'oil', 'watercolor', 'charcoal', 'text') then
    raise exception 'invalid_tool';
  end if;
  if p_color is null or p_color !~ '^#[0-9a-f]{6}$' then raise exception 'invalid_color'; end if;
  -- (NaN sorts above every number in Postgres, so it fails these range checks too.)
  if p_size is null or p_size < 0.5 or p_size > 400 then raise exception 'invalid_size'; end if;
  if p_opacity is null or p_opacity < 0.05 or p_opacity > 1 then
    raise exception 'invalid_opacity';
  end if;

  -- Rate limit: 90 strokes per rolling minute is far beyond human painting speed.
  if v_profile.rate_window is null or v_profile.rate_window < now() - interval '60 seconds' then
    v_profile.rate_window := now();
    v_profile.rate_count := 0;
  end if;
  if v_profile.rate_count >= 90 then raise exception 'slow_down'; end if;

  begin
    v_bytes := decode(coalesce(p_points, ''), 'base64');
  exception when others then
    raise exception 'invalid_points';
  end;

  if length(v_bytes) < 6 or (length(v_bytes) - 1) % 5 <> 0 or get_byte(v_bytes, 0) <> 1 then
    raise exception 'invalid_points';
  end if;
  v_n := (length(v_bytes) - 1) / 5;
  if v_n > 3000 then raise exception 'stroke_too_long'; end if;

  for v_i in 0 .. v_n - 1 loop
    v_off := 1 + v_i * 5;
    v_x := (get_byte(v_bytes, v_off) + get_byte(v_bytes, v_off + 1) * 256) / 4.0;
    v_y := (get_byte(v_bytes, v_off + 2) + get_byte(v_bytes, v_off + 3) * 256) / 4.0;
    if v_x > v_canvas.width or v_y > v_canvas.height then raise exception 'out_of_bounds'; end if;
    if v_i > 0 then
      v_len := v_len + sqrt((v_x - v_px) ^ 2 + (v_y - v_py) ^ 2);
    end if;
    v_px := v_x;
    v_py := v_y;
    v_minx := least(v_minx, v_x);
    v_miny := least(v_miny, v_y);
    v_maxx := greatest(v_maxx, v_x);
    v_maxy := greatest(v_maxy, v_y);
  end loop;

  if p_tool = 'text' then
    if v_n <> 1 then raise exception 'invalid_points'; end if;
    if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 200 or p_body ~ '[\n\r\t]' then
      raise exception 'invalid_text';
    end if;
    if p_font is null or p_font not in ('hand', 'serif', 'sans') then raise exception 'invalid_font'; end if;
    -- Generous box around the text: anchor is baseline-left. Width estimate keeps bbox queries correct.
    v_maxx := v_minx + char_length(p_body) * p_size * 0.75 + p_size;
    v_miny := v_miny - p_size * 1.1;
    v_maxy := v_maxy + p_size * 0.45;
    v_minx := v_minx - p_size * 0.2;
    v_cost := char_length(p_body) * p_size * p_size * 0.5;
  else
    if p_body is not null or p_font is not null then raise exception 'invalid_text'; end if;
    v_pad := p_size;  -- brushes can spread up to ~size around their path (bristles, watercolor bloom)
    v_minx := v_minx - v_pad;
    v_miny := v_miny - v_pad;
    v_maxx := v_maxx + v_pad;
    v_maxy := v_maxy + v_pad;
    v_cost := (v_len + p_size) * p_size;
  end if;

  -- The ink well. A stroke is allowed as long as there is ANY ink when it starts, so nobody is
  -- cut off mid-line; the balance may dip below zero and simply takes longer to refill.
  v_balance := public._ink_balance(v_profile.ink, v_profile.ink_at, v_canvas.ink_capacity, v_canvas.ink_refill_seconds);
  if v_balance <= 0 then raise exception 'out_of_ink'; end if;

  insert into public.strokes (canvas_id, artist_no, tool, color, size, opacity, points, body, font,
                              min_x, min_y, max_x, max_y, ink_cost)
  values (p_canvas, v_profile.artist_no, p_tool, p_color, p_size, p_opacity, p_points, p_body, p_font,
          v_minx, v_miny, v_maxx, v_maxy, v_cost)
  returning * into v_stroke;

  update public.profiles
     set ink        = greatest(v_balance - v_cost, -0.5 * v_canvas.ink_capacity),
         ink_at     = now(),
         rate_window = v_profile.rate_window,
         rate_count  = v_profile.rate_count + 1
   where id = v_uid;

  return v_stroke;
end;
$$;

-- Undo / redo / eraser for your own strokes only.
create or replace function public.set_stroke_erased(p_stroke bigint, p_erased boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_artist  bigint;
  v_stroke  public.strokes;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select artist_no into v_artist from public.profiles where id = v_uid and banned_at is null;
  if v_artist is null then raise exception 'not_allowed'; end if;

  select * into v_stroke from public.strokes where id = p_stroke for update;
  if not found then raise exception 'not_found'; end if;
  if v_stroke.artist_no is distinct from v_artist then raise exception 'not_yours'; end if;
  if v_stroke.hidden then raise exception 'not_allowed'; end if;
  perform public._open_canvas(v_stroke.canvas_id);

  update public.strokes set erased = coalesce(p_erased, true) where id = p_stroke;
end;
$$;

create or replace function public.report_stroke(p_stroke bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_reason is null or p_reason not in ('hate', 'sexual', 'violence', 'spam', 'personal_info', 'other') then
    raise exception 'invalid_reason';
  end if;
  if not exists (select 1 from public.strokes where id = p_stroke) then raise exception 'not_found'; end if;
  insert into public.reports (stroke_id, reporter, reason) values (p_stroke, v_uid, p_reason)
  on conflict (stroke_id, reporter) do nothing;
end;
$$;

------------------------------------------------------------------------------------------------
-- Moderation (admins only: set profiles.is_admin = true by hand in the SQL editor)
------------------------------------------------------------------------------------------------

create or replace function public._require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and is_admin) then
    raise exception 'not_admin';
  end if;
  return v_uid;
end;
$$;
revoke all on function public._require_admin() from public, anon, authenticated;

create or replace function public.admin_set_hidden(p_stroke bigint, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_admin();
  v_s     public.strokes;
  v_h     public.stroke_hidden;
begin
  select * into v_s from public.strokes where id = p_stroke for update;
  if not found then raise exception 'not_found'; end if;

  if p_hidden and not v_s.hidden then
    insert into public.stroke_hidden (stroke_id, points, body, hidden_by) values (v_s.id, v_s.points, v_s.body, v_admin);
    update public.strokes set hidden = true, points = '', body = null where id = v_s.id;
  elsif not p_hidden and v_s.hidden then
    select * into v_h from public.stroke_hidden where stroke_id = v_s.id;
    update public.strokes set hidden = false, points = v_h.points, body = v_h.body where id = v_s.id;
    delete from public.stroke_hidden where stroke_id = v_s.id;
  end if;

  update public.reports set resolved_at = now() where stroke_id = p_stroke and resolved_at is null;
end;
$$;

-- Hide everything an artist ever painted and ban them.
create or replace function public.admin_ban_artist(p_artist bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_admin();
  v_count integer;
begin
  update public.profiles set banned_at = now() where artist_no = p_artist and not is_admin;

  insert into public.stroke_hidden (stroke_id, points, body, hidden_by)
  select id, points, body, v_admin from public.strokes where artist_no = p_artist and not hidden;

  update public.strokes set hidden = true, points = '', body = null
   where artist_no = p_artist and not hidden;
  get diagnostics v_count = row_count;

  update public.reports r set resolved_at = now()
    from public.strokes s
   where s.id = r.stroke_id and s.artist_no = p_artist and r.resolved_at is null;
  return v_count;
end;
$$;

create or replace function public.admin_open_reports()
returns table (
  stroke_id bigint, artist_no bigint, username text, tool text, min_x real, min_y real, max_x real, max_y real,
  hidden boolean, reports bigint, reasons text[], last_report timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select s.id, s.artist_no, p.username, s.tool, s.min_x, s.min_y, s.max_x, s.max_y, s.hidden,
         count(r.id), array_agg(distinct r.reason), max(r.created_at)
    from public.reports r
    join public.strokes s on s.id = r.stroke_id
    left join public.profiles p on p.artist_no = s.artist_no
   where r.resolved_at is null
   group by s.id, p.username
   order by count(r.id) desc, max(r.created_at) desc
   limit 200;
end;
$$;

create or replace function public.admin_dismiss_reports(p_stroke bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.reports set resolved_at = now() where stroke_id = p_stroke and resolved_at is null;
end;
$$;

------------------------------------------------------------------------------------------------
-- Who may call what
------------------------------------------------------------------------------------------------

revoke all on function public.my_state()                                             from public, anon, authenticated;
revoke all on function public.artist_names(bigint[])                                  from public, anon, authenticated;
revoke all on function public.artist_by_username(text)                                from public, anon, authenticated;
revoke all on function public.canvas_stats(uuid)                                      from public, anon, authenticated;
revoke all on function public.draw_stroke(uuid, text, text, real, real, text, text, text) from public, anon, authenticated;
revoke all on function public.set_stroke_erased(bigint, boolean)                      from public, anon, authenticated;
revoke all on function public.report_stroke(bigint, text)                             from public, anon, authenticated;
revoke all on function public.admin_set_hidden(bigint, boolean)                       from public, anon, authenticated;
revoke all on function public.admin_ban_artist(bigint)                                from public, anon, authenticated;
revoke all on function public.admin_open_reports()                                    from public, anon, authenticated;
revoke all on function public.admin_dismiss_reports(bigint)                           from public, anon, authenticated;

grant execute on function public.my_state()                                             to anon, authenticated;
grant execute on function public.artist_names(bigint[])                                  to anon, authenticated;
grant execute on function public.artist_by_username(text)                                to anon, authenticated;
grant execute on function public.canvas_stats(uuid)                                      to anon, authenticated;
grant execute on function public.draw_stroke(uuid, text, text, real, real, text, text, text) to authenticated;
grant execute on function public.set_stroke_erased(bigint, boolean)                      to authenticated;
grant execute on function public.report_stroke(bigint, text)                             to authenticated;
grant execute on function public.admin_set_hidden(bigint, boolean)                       to authenticated;
grant execute on function public.admin_ban_artist(bigint)                                to authenticated;
grant execute on function public.admin_open_reports()                                    to authenticated;
grant execute on function public.admin_dismiss_reports(bigint)                           to authenticated;

------------------------------------------------------------------------------------------------
-- Realtime: strokes appear (and disappear) live for everyone
------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.strokes;
  end if;
end;
$$;
