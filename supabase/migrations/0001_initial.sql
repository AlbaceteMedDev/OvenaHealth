-- Ovena Health Commerce Portal — initial schema
--
-- Single shared workspace: every authenticated user sees and edits the same
-- inventory_state rows. Row-level security ensures only signed-in users can
-- read or write.
--
-- Run this once in Supabase Studio → SQL Editor. Idempotent.

-- ─── Helpers ───────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── inventory_state ──────────────────────────────────────────────────
create table if not exists public.inventory_state (
  sku text primary key,
  amazon_qty integer not null default 0 check (amazon_qty >= 0),
  shopify_qty integer not null default 0 check (shopify_qty >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  cogs numeric(10, 2) not null default 0 check (cogs >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists inventory_state_updated_at_idx
  on public.inventory_state (updated_at desc);

-- Auto-stamp updated_at + updated_by on every row mutation.
create or replace function public.set_inventory_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_inventory_audit on public.inventory_state;
create trigger trg_inventory_audit
  before insert or update on public.inventory_state
  for each row execute function public.set_inventory_audit();

-- ─── Row level security ──────────────────────────────────────────────
alter table public.inventory_state enable row level security;

drop policy if exists "auth read" on public.inventory_state;
create policy "auth read"
  on public.inventory_state
  for select
  to authenticated
  using (true);

drop policy if exists "auth insert" on public.inventory_state;
create policy "auth insert"
  on public.inventory_state
  for insert
  to authenticated
  with check (true);

drop policy if exists "auth update" on public.inventory_state;
create policy "auth update"
  on public.inventory_state
  for update
  to authenticated
  using (true)
  with check (true);

-- ─── Seed catalog ─────────────────────────────────────────────────────
-- Idempotent: seeds default reorder_level on first install only;
-- existing rows are not modified.
insert into public.inventory_state (sku, reorder_level) values
  ('CWD-2X2', 80),
  ('CWD-4X4', 70),
  ('CWD-7X7', 60),
  ('CWD-PWD', 75),
  ('GAUZE-ROLL', 100),
  ('SFD-4X4', 75),
  ('SFD-6X6', 70),
  ('SFD-8X8', 65),
  ('GLOVE-DISP', 200),
  ('WOUND-WASH', 90),
  ('CS-KHC-S1-BLK', 40), ('CS-KHC-S1-BGE', 40),
  ('CS-KHC-S2-BLK', 40), ('CS-KHC-S2-BGE', 40),
  ('CS-KHC-S3-BLK', 40), ('CS-KHC-S3-BGE', 40),
  ('CS-KHC-S4-BLK', 40), ('CS-KHC-S4-BGE', 40),
  ('CS-KHC-S5-BLK', 40), ('CS-KHC-S5-BGE', 40),
  ('CS-KHO-S1-BLK', 40), ('CS-KHO-S1-BGE', 40),
  ('CS-KHO-S2-BLK', 40), ('CS-KHO-S2-BGE', 40),
  ('CS-KHO-S3-BLK', 40), ('CS-KHO-S3-BGE', 40),
  ('CS-KHO-S4-BLK', 40), ('CS-KHO-S4-BGE', 40),
  ('CS-KHO-S5-BLK', 40), ('CS-KHO-S5-BGE', 40),
  ('CS-THC-S1-BLK', 40), ('CS-THC-S1-BGE', 40),
  ('CS-THC-S2-BLK', 40), ('CS-THC-S2-BGE', 40),
  ('CS-THC-S3-BLK', 40), ('CS-THC-S3-BGE', 40),
  ('CS-THC-S4-BLK', 40), ('CS-THC-S4-BGE', 40),
  ('CS-THC-S5-BLK', 40), ('CS-THC-S5-BGE', 40),
  ('CS-THO-S1-BLK', 40), ('CS-THO-S1-BGE', 40),
  ('CS-THO-S2-BLK', 40), ('CS-THO-S2-BGE', 40),
  ('CS-THO-S3-BLK', 40), ('CS-THO-S3-BGE', 40),
  ('CS-THO-S4-BLK', 40), ('CS-THO-S4-BGE', 40),
  ('CS-THO-S5-BLK', 40), ('CS-THO-S5-BGE', 40)
on conflict (sku) do nothing;
