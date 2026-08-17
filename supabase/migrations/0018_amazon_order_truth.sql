-- Amazon sales become order-level truth; Catchr keeps only traffic and ads.
--
-- WHY THIS EXISTS
-- The portal's Amazon revenue was overstated by almost exactly 2x — 238 units
-- / $3,686.44 against Amazon's own 125 units / $1,937.66 for 23 Jul-17 Aug.
-- The cause was the SHAPE of the Catchr request, not the data. Catchr's
-- amazon-seller connector is accurate over a multi-day window and returns
-- inflated numbers for a SINGLE day combined with product dimensions. The
-- sync asked one day at a time — the workaround for Catchr silently dropping
-- the date dimension whenever a SKU dimension is present — so every stored
-- day was wrong. Measured against Amazon's All Orders report, 2026-08-17:
--
--   date dimension, full window  -> 125 units, matches Amazon on 26/26 days
--   sku  dimension, full window  -> 120 units, matches Amazon per SKU
--   sku  dimension, single day   ->  17 units on 8/9 where Amazon says 4
--   traffic, same single-day rows -> 2,073 sessions against a true 1,392
--
-- The 26/26 match only appears once Amazon's orders are bucketed in PACIFIC
-- time. Catchr reports in Amazon's native timezone; the CSV exports in UTC.
-- Bucketing UTC timestamps by their UTC date disagrees on 20 of 26 days,
-- because evening orders after 5pm PT land on the next UTC day.
--
-- Cumulative differencing — cum(D) minus cum(D-1) — was tested as a way to
-- keep per-day-per-SKU rows from Catchr. It does NOT work: historical
-- windows come back stale, so the difference collapses to near zero (4 units
-- derived for 8/3 where Amazon has 23). Catchr cannot produce trustworthy
-- per-SKU daily sales at any window size.
--
-- So sales now come from Amazon's All Orders report, which is order-item
-- level ground truth and is the same payload SP-API returns from
-- GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL. When SP-API is
-- authorised the loader swaps its input and nothing downstream changes.
--
-- amz_sales_daily is NOT dropped and NOT zeroed — it was reloaded from the
-- order report on 2026-08-17 and now agrees with Amazon to the cent. It
-- keeps its role as per-day-per-SKU sales; only its traffic columns are dead,
-- because per-SKU-per-day traffic is the one figure no source can supply.

-- ─── Daily traffic ───────────────────────────────────────────────────
-- Per-DAY totals, which Catchr does report accurately. Kept apart from
-- amz_sales_daily because that table is keyed per SKU and a per-day total
-- cannot be split across SKUs without inventing the split.
create table if not exists public.amz_traffic_daily (
  date            date not null,
  marketplace_id  text not null,
  sessions        integer not null default 0,
  page_views      integer not null default 0,
  units_ordered   integer not null default 0,
  ordered_sales   numeric(12,2) not null default 0,
  synced_at       timestamptz not null default now(),
  primary key (date, marketplace_id)
);

create index if not exists amz_traffic_daily_date_idx
  on public.amz_traffic_daily (date desc);

alter table public.amz_traffic_daily enable row level security;
drop policy if exists "auth read" on public.amz_traffic_daily;
create policy "auth read" on public.amz_traffic_daily
  for select to authenticated using (true);

-- ─── Orders ──────────────────────────────────────────────────────────
-- One row per order ITEM. An order containing three SKUs is three rows
-- sharing an amazon_order_id, which is what makes a distinct-purchaser count
-- (count distinct amazon_order_id) different from a unit count (sum
-- quantity) — the two numbers the Overview tab shows side by side.
create table if not exists public.amz_orders (
  order_item_id       text primary key,
  amazon_order_id     text not null,
  purchase_at         timestamptz not null,

  -- Pacific calendar day, computed by the loader. Not a generated column:
  -- `at time zone` is STABLE rather than IMMUTABLE, so Postgres rejects it.
  purchase_day        date not null,

  order_status        text not null,
  fulfillment_channel text,
  sales_channel       text,
  ship_service_level  text,

  sku                 text,
  asin                text,
  product_name        text,

  quantity            integer not null default 0,
  currency            text not null default 'USD',
  item_price          numeric(12,2) not null default 0,
  item_tax            numeric(12,2) not null default 0,
  shipping_price      numeric(12,2) not null default 0,
  shipping_tax        numeric(12,2) not null default 0,
  item_promo_discount numeric(12,2) not null default 0,
  ship_promo_discount numeric(12,2) not null default 0,

  ship_city           text,
  ship_state          text,
  ship_postal_code    text,
  ship_country        text,
  is_business_order   boolean not null default false,
  promotion_ids       text,

  synced_at           timestamptz not null default now()
);

create index if not exists amz_orders_day_idx   on public.amz_orders (purchase_day desc);
create index if not exists amz_orders_sku_idx   on public.amz_orders (sku);
create index if not exists amz_orders_order_idx on public.amz_orders (amazon_order_id);

alter table public.amz_orders enable row level security;
drop policy if exists "auth read" on public.amz_orders;
create policy "auth read" on public.amz_orders
  for select to authenticated using (true);

-- ─── Settlement transactions ─────────────────────────────────────────
-- The money that actually moved, and the only trustworthy source of fees.
-- The portal previously modelled Amazon fees from an FBA fee schedule and
-- produced $1,110.94 against $83.26 actually charged — 13x too high, because
-- 128 of 130 order items are merchant-fulfilled and never incur a fulfilment
-- fee. Per-unit referral fees measured from this data, by joining every
-- settlement payment to its order (102 of 102 matched):
--
--   CS-KHC-L-BLK 1.15   CS-KHC-M-BLK 1.23   CS-KHC-S-BLK 1.12
--   CS-KHC-XL-BLK 1.37  CWD-PWD 0.60        HC-ROLL16FT 0.74
--   HC-ROLL5FT 0.10     SOCK-AID 0.72
--
-- HC-ROLL5FT really is near zero: 5 of its orders have settled Released with
-- a $0.00 fee, so this is not deferred-fee lag. Most likely the new-seller
-- referral discount, which expires — worth re-measuring each month.
--
-- Service fees are period costs no per-unit model captures: FBA inbound
-- freight (-$637.46 with a +$132.04 reversal, so -$505.42 net) and the
-- $39.99/mo subscription (-$79.98 for two months).
--
-- No natural key: an order can settle across several rows (payment, then
-- refund) and service fees carry no order id at all. row_hash digests the
-- whole line, which makes re-importing the same export idempotent.
create table if not exists public.amz_transactions (
  row_hash         text primary key,
  posted_on        date not null,
  status           text,
  transaction_type text not null,
  amazon_order_id  text,
  product_details  text,
  product_charges  numeric(12,2) not null default 0,
  promo_rebates    numeric(12,2) not null default 0,
  amazon_fees      numeric(12,2) not null default 0,
  other_amount     numeric(12,2) not null default 0,
  total_amount     numeric(12,2) not null default 0,
  synced_at        timestamptz not null default now()
);

create index if not exists amz_transactions_day_idx   on public.amz_transactions (posted_on desc);
create index if not exists amz_transactions_type_idx  on public.amz_transactions (transaction_type);
create index if not exists amz_transactions_order_idx on public.amz_transactions (amazon_order_id);

alter table public.amz_transactions enable row level security;
drop policy if exists "auth read" on public.amz_transactions;
create policy "auth read" on public.amz_transactions
  for select to authenticated using (true);

-- ─── The other fee schedule ──────────────────────────────────────────
-- inventory_state.amazon_fee holds ONE rate per SKU, but there are two, and
-- which applies depends on who ships. Nearly everything sold so far has been
-- merchant-fulfilled, so amazon_fee now carries the FBM rate — referral only,
-- confirmed twice over: measured from 102 settlement payments joined to their
-- orders, and matching Seller Central's own per-unit estimates to the cent
-- (CWD-PWD $0.60 both ways, HC-ROLL16FT $0.72 vs $0.74, SOCK-AID $0.75 vs
-- $0.72, HC-ROLL5FT $0.00 vs $0.10).
--
-- The FBA rate is 4-9x higher because it buys pick, pack and delivery. Those
-- are the figures the portal used to apply to every unit, which is where the
-- $1,110.94 fee estimate came from against $83.26 actually charged.
--
-- Stored rather than discarded because FBA stock is inbound: every FBA
-- listing is at 0 units today except SOCK-AID-FBA, and the moment those sell
-- the fee per unit jumps to this column. Keeping both makes the switch a
-- reported change instead of a silent margin collapse.
alter table public.inventory_state
  add column if not exists amazon_fee_fba numeric(10,2) not null default 0;

comment on column public.inventory_state.amazon_fee is
  'Per-unit Amazon fee when MERCHANT-fulfilled: referral only. Measured from settlement.';
comment on column public.inventory_state.amazon_fee_fba is
  'Per-unit Amazon fee when FBA-fulfilled: referral plus fulfilment. Seller Central estimate, 2026-08-17.';

update public.inventory_state set amazon_fee_fba = v.fee
from (values
  ('CS-KHC-L-BLK', 6.23), ('CS-KHC-M-BLK', 6.23),
  ('CS-KHC-S-BLK', 6.23), ('CS-KHC-XL-BLK', 6.23),
  ('CWD-2X2',      4.52), ('CWD-4X4',      7.11),
  ('CWD-PWD',      5.49), ('SOCK-AID',     5.97),
  ('HC-ROLL5FT',   3.01), ('HC-ROLL16FT',  4.81)
) as v(sku, fee)
where public.inventory_state.sku = v.sku;

-- ─── Mark the dead traffic columns ───────────────────────────────────
-- Left in place rather than dropped so a stale deploy reading the old shape
-- shows zero instead of a wrong number that looks plausible.
comment on column public.amz_sales_daily.sessions is
  'DEAD 2026-08-17 — always 0. Per-SKU-per-day traffic is not obtainable. Use amz_traffic_daily.';
comment on column public.amz_sales_daily.page_views is
  'DEAD 2026-08-17 — always 0. Use amz_traffic_daily.';
