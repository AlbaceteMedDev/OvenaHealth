-- Shopify storefront sales + Google Merchant Center feed health.
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.
--
-- WHY SHOPIFY AND NOT GA4
-- GA4 is connected and reports ecommerce revenue, but it fires `purchase`
-- at checkout and never learns about refunds. Measured 2026-08-12 it put
-- "Collagen Kit" at $823.91 against a Shopify gross of $441.95 and a net of
-- $0.00 — every Collagen Kit order had been refunded within days. Shopify
-- Admin is the only source that nets refunds, so money comes from here.
-- GA4 remains useful for traffic and channel mix; not for revenue.

-- ─── shop_sales_daily ────────────────────────────────────────────────
-- One row per (date, product, variant). `net_sales` is after discounts AND
-- after refunds — a fully refunded line lands at 0, which is the number
-- that should drive every product ranking.
create table if not exists public.shop_sales_daily (
  date date not null,
  product_title text not null default '',
  variant_title text not null default '',
  product_id text,
  gross_sales numeric(12, 2) not null default 0,
  discounts numeric(12, 2) not null default 0,
  net_sales numeric(12, 2) not null default 0,
  quantity integer not null default 0,
  net_quantity integer not null default 0,
  orders integer not null default 0,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (date, product_title, variant_title)
);

create index if not exists shop_sales_daily_date_idx
  on public.shop_sales_daily (date desc);

-- ─── shop_totals_daily ───────────────────────────────────────────────
-- Order counts can't be summed across products (one order spans several
-- line items), so store-wide daily totals live in their own table.
create table if not exists public.shop_totals_daily (
  date date not null primary key,
  gross_sales numeric(12, 2) not null default 0,
  discounts numeric(12, 2) not null default 0,
  refunds numeric(12, 2) not null default 0,
  net_sales numeric(12, 2) not null default 0,
  orders integer not null default 0,
  units integer not null default 0,
  currency text not null default 'USD',
  synced_at timestamptz not null default now()
);

create index if not exists shop_totals_daily_date_idx
  on public.shop_totals_daily (date desc);

-- ─── gmc_account_issues ──────────────────────────────────────────────
-- Account-level Merchant Center problems. As of 2026-08-12 this account is
-- suspended for Misrepresentation, which means Shopping cannot serve at
-- all — the Google tab shows this so ad spend is never read in isolation.
create table if not exists public.gmc_account_issues (
  account_id text not null,
  title text not null,
  severity text,
  documentation text,
  synced_at timestamptz not null default now(),
  primary key (account_id, title)
);

-- ─── gmc_product_status ──────────────────────────────────────────────
create table if not exists public.gmc_product_status (
  account_id text not null,
  product_title text not null,
  destination_status text,
  availability text,
  synced_at timestamptz not null default now(),
  primary key (account_id, product_title)
);

-- ─── Row level security ──────────────────────────────────────────────
-- Same shared-workspace policy as the rest of the schema: signed-in
-- teammates read; only the sync jobs (service_role, which bypasses RLS)
-- write. No insert/update/delete policies on purpose.
alter table public.shop_sales_daily    enable row level security;
alter table public.shop_totals_daily   enable row level security;
alter table public.gmc_account_issues  enable row level security;
alter table public.gmc_product_status  enable row level security;

drop policy if exists "auth read" on public.shop_sales_daily;
create policy "auth read" on public.shop_sales_daily
  for select to authenticated using (true);

drop policy if exists "auth read" on public.shop_totals_daily;
create policy "auth read" on public.shop_totals_daily
  for select to authenticated using (true);

drop policy if exists "auth read" on public.gmc_account_issues;
create policy "auth read" on public.gmc_account_issues
  for select to authenticated using (true);

drop policy if exists "auth read" on public.gmc_product_status;
create policy "auth read" on public.gmc_product_status
  for select to authenticated using (true);
