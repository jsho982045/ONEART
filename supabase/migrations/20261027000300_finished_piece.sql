-- ONEART: the finished piece and buying a copy.
--
-- After a canvas closes, the worker renders it at full resolution into the PRIVATE `finals` bucket and a
-- watermarked, reduced preview into the public `tiles` bucket. Buying happens through Stripe Checkout;
-- only the Stripe webhook (server side, service role) records purchases. Downloads are short-lived signed
-- links handed out by the server after it checks the purchase.

alter table public.canvases
  add column final_ready_at   timestamptz,
  add column final_width      integer,
  add column final_height     integer,
  add column price_cents      integer not null default 199 check (price_cents >= 50),
  add column currency         text not null default 'usd' check (currency ~ '^[a-z]{3}$');

create table public.purchases (
  id                 bigint generated always as identity primary key,
  user_id            uuid references public.profiles (id) on delete set null,
  canvas_id          uuid not null references public.canvases (id) on delete restrict,
  stripe_session_id  text not null unique,
  stripe_payment_intent text,
  amount_cents       integer not null,
  currency           text not null,
  created_at         timestamptz not null default now(),
  refunded_at        timestamptz
);

create index purchases_user_canvas_idx on public.purchases (user_id, canvas_id);
create index purchases_payment_intent_idx on public.purchases (stripe_payment_intent);

alter table public.purchases enable row level security;
revoke all on public.purchases from anon, authenticated;

-- Did the signed-in person paint on this canvas? (Only participants can buy a copy.)
create or replace function public.has_painted(p_canvas uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.strokes s join public.profiles p on p.artist_no = s.artist_no
     where p.id = auth.uid() and s.canvas_id = p_canvas and not s.erased and not s.hidden
  );
$$;

-- Does the signed-in person own a (non-refunded) copy?
create or replace function public.owns_copy(p_canvas uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.purchases
     where user_id = auth.uid() and canvas_id = p_canvas and refunded_at is null
  );
$$;

revoke all on function public.has_painted(uuid) from public, anon, authenticated;
revoke all on function public.owns_copy(uuid) from public, anon, authenticated;
grant execute on function public.has_painted(uuid) to authenticated;
grant execute on function public.owns_copy(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public) values ('finals', 'finals', false) on conflict (id) do nothing;
  end if;
end;
$$;
