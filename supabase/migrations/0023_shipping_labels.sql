-- Postage actually bought, one row per shipping label.
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.
--
-- WHY
-- Outbound shipping was estimated: shipments counted from orders, multiplied
-- by an average ship_to_customer rate. Measured against the label history for
-- 2026-07-22..08-26 the estimate was wrong twice over — $677.60 against
-- $1,860.02 actually paid — because BOTH of its inputs were wrong:
--
--   the rate    $4.40 assumed, $9.38 actually paid
--   the count   154 shipments counted, 185 labels actually bought
--
-- The count is the less obvious half. One order does not mean one label: a
-- multi-box order buys several, and a reship or a return buys another. No
-- figure derived from the order table can see any of that, so the only honest
-- source for postage is the postage itself.
--
-- WHY LABELS AND NOT A DAILY TOTAL
-- The tracking number gives a natural key, so re-importing an overlapping
-- export corrects rows instead of double-counting them — which a daily total
-- could not do. It also means an excluded shipper can be reconsidered later
-- without re-importing anything.
--
-- WHAT CANNOT BE DONE WITH THIS
-- The export carries no Order ID, Store or Cost Code — all blank on all 195
-- rows measured — so a label cannot be attributed to an order, or split
-- between Amazon and Shopify. Per-day totals are the finest honest grain, and
-- the P&L charges postage as a single cost across both channels.

create table if not exists public.ship_labels (
  -- Unique and never blank across the 195 labels measured, so it is the key.
  tracking text not null primary key,
  date_printed date not null,
  -- Amount Paid plus Adjusted Amount: a carrier reweigh adjustment is money
  -- paid for that label and belongs in its cost.
  amount numeric(10, 2) not null default 0,
  carrier text,
  service text,
  weight text,
  recipient text,
  -- Refunded labels are not a cost. Held as the carrier's own status text
  -- rather than a boolean, because "Request Scheduled" is not yet "Approved"
  -- and only the approved ones should stop counting.
  refund_status text,
  imported_at timestamptz not null default now()
);

create index if not exists ship_labels_date_idx
  on public.ship_labels (date_printed desc);

-- ─── Row level security ──────────────────────────────────────────────
-- Same shared-workspace policy as inventory_state, and for the same reason:
-- this table is written from the browser by the CSV import, not by a sync
-- job holding the service role. Signed-in teammates read and write; delete
-- is allowed so a bad import can be undone without opening Supabase.
alter table public.ship_labels enable row level security;

drop policy if exists "auth read" on public.ship_labels;
create policy "auth read"
  on public.ship_labels
  for select
  to authenticated
  using (true);

drop policy if exists "auth insert" on public.ship_labels;
create policy "auth insert"
  on public.ship_labels
  for insert
  to authenticated
  with check (true);

drop policy if exists "auth update" on public.ship_labels;
create policy "auth update"
  on public.ship_labels
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "auth delete" on public.ship_labels;
create policy "auth delete"
  on public.ship_labels
  for delete
  to authenticated
  using (true);
