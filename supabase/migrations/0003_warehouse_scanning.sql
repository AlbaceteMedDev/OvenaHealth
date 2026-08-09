-- Warehouse barcode scanning + Amazon report imports.
--
-- The Inventory tab's "Warehouse" column reuses the legacy shopify_qty
-- column on inventory_state (it already held the stock our warehouse
-- fulfills), so no data migration is needed there. This file only adds:
--
--   barcodes        product barcode (UPC/EAN/FNSKU) → portal SKU
--   scan_events     append-only audit log of every warehouse scan
--   amazon_sku_map  Amazon seller-SKU → portal SKU, learned during
--                   report imports when the names differ
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.

-- ─── barcodes ─────────────────────────────────────────────────────────
create table if not exists public.barcodes (
  barcode text primary key,
  sku text not null references public.inventory_state(sku) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists barcodes_sku_idx on public.barcodes (sku);

-- ─── scan_events ──────────────────────────────────────────────────────
create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  barcode text,
  mode text not null check (mode in ('receive', 'pick', 'count')),
  delta integer not null,
  qty_after integer not null check (qty_after >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists scan_events_created_at_idx
  on public.scan_events (created_at desc);

-- Stamp created_by server-side so the log can't be written as someone else.
create or replace function public.set_scan_event_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  new.created_at := now();
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_scan_event_audit on public.scan_events;
create trigger trg_scan_event_audit
  before insert on public.scan_events
  for each row execute function public.set_scan_event_audit();

-- ─── amazon_sku_map ───────────────────────────────────────────────────
create table if not exists public.amazon_sku_map (
  amazon_sku text primary key,
  sku text not null references public.inventory_state(sku) on delete cascade,
  created_at timestamptz not null default now()
);

-- ─── Row level security ──────────────────────────────────────────────
-- Same shared-workspace policy as inventory_state: any signed-in
-- teammate can read and write. scan_events is insert-only (append-only
-- audit log — no update/delete policy on purpose).
alter table public.barcodes enable row level security;
alter table public.scan_events enable row level security;
alter table public.amazon_sku_map enable row level security;

drop policy if exists "auth read" on public.barcodes;
create policy "auth read" on public.barcodes
  for select to authenticated using (true);

drop policy if exists "auth insert" on public.barcodes;
create policy "auth insert" on public.barcodes
  for insert to authenticated with check (true);

drop policy if exists "auth update" on public.barcodes;
create policy "auth update" on public.barcodes
  for update to authenticated using (true) with check (true);

drop policy if exists "auth delete" on public.barcodes;
create policy "auth delete" on public.barcodes
  for delete to authenticated using (true);

drop policy if exists "auth read" on public.scan_events;
create policy "auth read" on public.scan_events
  for select to authenticated using (true);

drop policy if exists "auth insert" on public.scan_events;
create policy "auth insert" on public.scan_events
  for insert to authenticated with check (true);

drop policy if exists "auth read" on public.amazon_sku_map;
create policy "auth read" on public.amazon_sku_map
  for select to authenticated using (true);

drop policy if exists "auth insert" on public.amazon_sku_map;
create policy "auth insert" on public.amazon_sku_map
  for insert to authenticated with check (true);

drop policy if exists "auth update" on public.amazon_sku_map;
create policy "auth update" on public.amazon_sku_map
  for update to authenticated using (true) with check (true);

drop policy if exists "auth delete" on public.amazon_sku_map;
create policy "auth delete" on public.amazon_sku_map
  for delete to authenticated using (true);
