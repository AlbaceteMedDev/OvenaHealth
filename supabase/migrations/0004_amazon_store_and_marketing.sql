-- Retarget the portal at the live Amazon store, and add the tables the
-- Catchr + SP-API sync jobs write into.
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.
--
-- NOTE ON RETIRED SKUs
-- The seed catalog previously carried 40 speculative compression-sock
-- variants (CS-{KHC,KHO,THC,THO}-S{1..5}-{BLK,BGE}) that were never listed.
-- Nothing is deleted here — their inventory_state rows stay put — but they
-- are no longer seeded by the frontend, so any counts held against them
-- become invisible in the UI. Check for stranded stock before you rely on
-- the new numbers:
--
--   select sku, amazon_qty, shopify_qty, cogs from public.inventory_state
--   where sku ~ '^CS-(KHC|KHO|THC|THO)-S[1-5]-(BLK|BGE)$'
--     and (amazon_qty > 0 or shopify_qty > 0 or cogs > 0);
--
-- If that returns rows, move the quantities onto the real SKUs
-- (CS-KHC-{S,M,L,XL}-BLK) before deleting them.

-- ─── Catalog columns on inventory_state ──────────────────────────────
alter table public.inventory_state
  add column if not exists asin text,
  add column if not exists listed boolean not null default false,
  add column if not exists marketplace_id text;

create index if not exists inventory_state_asin_idx
  on public.inventory_state (asin) where asin is not null;

-- ─── Seed / update the live Amazon catalog ───────────────────────────
insert into public.inventory_state (sku, asin, listed, marketplace_id, reorder_level)
values
  ('HC-ROLL5FT',    'B0H8ZH3J9R', true, 'ATVPDKIKX0DER', 120),
  ('HC-ROLL16FT',   'B0H949P7JW', true, 'ATVPDKIKX0DER',  90),
  ('CS-KHC-S-BLK',  'B0H8ZT6Y7B', true, 'ATVPDKIKX0DER',  30),
  ('CS-KHC-M-BLK',  'B0H8ZVQPPB', true, 'ATVPDKIKX0DER',  45),
  ('CS-KHC-L-BLK',  'B0H8ZJPGL8', true, 'ATVPDKIKX0DER',  60),
  ('CS-KHC-XL-BLK', 'B0H8ZQQB4F', true, 'ATVPDKIKX0DER',  40),
  ('SOCK-AID',      'B0HC5X78B1', true, 'ATVPDKIKX0DER',  25)
on conflict (sku) do update
  set asin           = excluded.asin,
      listed         = true,
      marketplace_id = excluded.marketplace_id;

-- The separate FBA listing shares ASIN B0H8ZJPGL8 with CS-KHC-L-BLK.
insert into public.amazon_sku_map (amazon_sku, sku)
values ('CS-KHC-L-BLK-FBA', 'CS-KHC-L-BLK')
on conflict (amazon_sku) do update set sku = excluded.sku;

-- ─── amz_sales_daily ─────────────────────────────────────────────────
-- One row per (date, marketplace, seller SKU) from Catchr's amazon-seller
-- sales + traffic report. `sku` is the resolved catalog SKU; `amazon_sku`
-- is what Amazon reported, so FBA/MFN splits stay auditable.
create table if not exists public.amz_sales_daily (
  date date not null,
  marketplace_id text not null,
  amazon_sku text not null,
  sku text,
  asin text,
  title text,
  ordered_sales numeric(12, 2) not null default 0,
  units_ordered integer not null default 0,
  order_items integer not null default 0,
  units_refunded integer not null default 0,
  sessions integer not null default 0,
  page_views integer not null default 0,
  unit_session_pct numeric(6, 2) not null default 0,
  buy_box_pct numeric(6, 2) not null default 0,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (date, marketplace_id, amazon_sku)
);

create index if not exists amz_sales_daily_date_idx
  on public.amz_sales_daily (date desc);
create index if not exists amz_sales_daily_sku_idx
  on public.amz_sales_daily (sku, date desc);

-- ─── ads_daily ───────────────────────────────────────────────────────
-- One row per (date, platform, account, campaign). Covers amazon-ads,
-- facebook-ads and google-ads through the same shape so the Ads tab can
-- blend them. `attributed_sales` is platform-attributed, not audited
-- revenue — Amazon reports 14-day same-SKU + halo, Meta reports pixel
-- conversions. They are not directly comparable; the UI labels them.
create table if not exists public.ads_daily (
  date date not null,
  platform text not null,
  account_id text not null,
  account_name text,
  campaign_id text not null default '',
  campaign_name text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric(12, 2) not null default 0,
  attributed_sales numeric(12, 2) not null default 0,
  attributed_orders integer not null default 0,
  attributed_units integer not null default 0,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (date, platform, account_id, campaign_id)
);

create index if not exists ads_daily_date_idx
  on public.ads_daily (date desc);
create index if not exists ads_daily_platform_idx
  on public.ads_daily (platform, date desc);

-- ─── ads_sku_daily ───────────────────────────────────────────────────
-- Ad spend attributed down to an advertised SKU. This is what makes TACOS
-- (total ad cost of sale) per product possible: join against
-- amz_sales_daily on (date, sku).
create table if not exists public.ads_sku_daily (
  date date not null,
  platform text not null,
  account_id text not null,
  amazon_sku text not null,
  sku text,
  asin text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric(12, 2) not null default 0,
  attributed_sales numeric(12, 2) not null default 0,
  attributed_orders integer not null default 0,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (date, platform, account_id, amazon_sku)
);

create index if not exists ads_sku_daily_date_idx
  on public.ads_sku_daily (date desc);
create index if not exists ads_sku_daily_sku_idx
  on public.ads_sku_daily (sku, date desc);

-- ─── fba_inventory ───────────────────────────────────────────────────
-- Snapshot from Amazon SP-API FBA Inventory Summaries. Catchr does not
-- expose inventory for amazon-seller, so this comes straight from SP-API.
-- One current row per (marketplace, seller SKU) — no history, the Inventory
-- tab only ever wants "what's in FBA right now".
create table if not exists public.fba_inventory (
  marketplace_id text not null,
  amazon_sku text not null,
  sku text,
  asin text,
  fnsku text,
  condition text,
  fulfillable integer not null default 0,
  inbound_working integer not null default 0,
  inbound_shipped integer not null default 0,
  inbound_receiving integer not null default 0,
  reserved integer not null default 0,
  unfulfillable integer not null default 0,
  researching integer not null default 0,
  total integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (marketplace_id, amazon_sku)
);

create index if not exists fba_inventory_sku_idx on public.fba_inventory (sku);

-- ─── sync_runs ───────────────────────────────────────────────────────
-- Audit trail for the cron jobs, so the UI can show "last synced" and
-- surface failures instead of silently rendering stale numbers.
create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  status text not null check (status in ('ok', 'partial', 'error')),
  rows_written integer not null default 0,
  detail jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists sync_runs_job_idx
  on public.sync_runs (job, started_at desc);

-- ─── Row level security ──────────────────────────────────────────────
-- Same shared-workspace policy as the rest of the schema: any signed-in
-- teammate reads. Writes come from the sync jobs using the service_role
-- key, which bypasses RLS — so these tables are deliberately read-only to
-- the browser. No insert/update/delete policies on purpose.
alter table public.amz_sales_daily enable row level security;
alter table public.ads_daily       enable row level security;
alter table public.ads_sku_daily   enable row level security;
alter table public.fba_inventory   enable row level security;
alter table public.sync_runs       enable row level security;

drop policy if exists "auth read" on public.amz_sales_daily;
create policy "auth read" on public.amz_sales_daily
  for select to authenticated using (true);

drop policy if exists "auth read" on public.ads_daily;
create policy "auth read" on public.ads_daily
  for select to authenticated using (true);

drop policy if exists "auth read" on public.ads_sku_daily;
create policy "auth read" on public.ads_sku_daily
  for select to authenticated using (true);

drop policy if exists "auth read" on public.fba_inventory;
create policy "auth read" on public.fba_inventory
  for select to authenticated using (true);

drop policy if exists "auth read" on public.sync_runs;
create policy "auth read" on public.sync_runs
  for select to authenticated using (true);
