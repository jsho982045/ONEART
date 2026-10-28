-- ONEART: support for the background worker (baked overview tiles + lifecycle emails).
-- The worker connects with the SERVICE ROLE key, server-side only (Railway). Never ship that key to a browser.

------------------------------------------------------------------------------------------------
-- Know which strokes changed since the last bake (erased, restored, hidden by a moderator)
------------------------------------------------------------------------------------------------

alter table public.strokes add column changed_at timestamptz not null default now();
create index strokes_canvas_changed_idx on public.strokes (canvas_id, changed_at);

create or replace function public._touch_stroke()
returns trigger
language plpgsql
as $$
begin
  if new.erased is distinct from old.erased or new.hidden is distinct from old.hidden then
    new.changed_at := now();
  end if;
  return new;
end;
$$;

create trigger strokes_touch before update on public.strokes
  for each row execute function public._touch_stroke();

------------------------------------------------------------------------------------------------
-- Public bucket for baked tiles (only the worker writes to it)
------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public) values ('tiles', 'tiles', true) on conflict (id) do nothing;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- Lifecycle emails: each notice goes out once per canvas
------------------------------------------------------------------------------------------------

create table public.canvas_notices (
  canvas_id  uuid not null references public.canvases (id) on delete cascade,
  kind       text not null check (kind in ('three_days_left', 'closed')),
  sent_at    timestamptz not null default now(),
  recipients integer not null default 0,
  primary key (canvas_id, kind)
);

alter table public.canvas_notices enable row level security;
revoke all on public.canvas_notices from anon, authenticated;

-- Everyone who painted on a canvas (and still has an account). Worker only.
create or replace function public.worker_participants(p_canvas uuid)
returns table (email text, username text)
language sql
stable
security definer
set search_path = public
as $$
  select u.email, p.username
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.banned_at is null
     and u.email is not null
     and exists (select 1 from public.strokes s
                  where s.canvas_id = p_canvas and s.artist_no = p.artist_no and not s.erased and not s.hidden);
$$;

revoke all on function public.worker_participants(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.worker_participants(uuid) to service_role;
  end if;
end;
$$;
