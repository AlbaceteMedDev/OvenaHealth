-- Cost of goods, per retail unit sold.
--
-- `inventory_state.cogs` has been 0 for every SKU since 0001, which is why
-- the Margins tab reports 0% COGS coverage and no gross profit anywhere in
-- the portal. This fills it in from two source documents.
--
-- Sources
--   A. Huizhou Foryou Medical proforma invoice, PO FY-PIUS009000-0001A,
--      dated 2026-01-05. FOB Shenzhen, USD, 6,000 units / $56,020.00.
--      This is the collagen cost basis and supersedes the per-piece costs
--      implied by the first-order workbook.
--   B. "Ovena Retail Pricing and Profit Projection (first order).xlsx" —
--      cost per retail unit for the non-collagen line.
--
-- Basis: cost per RETAIL UNIT, matching what the Margins tab compares
-- against `suggestedPrice`. Every collagen listing is a 5-count (confirmed
-- against the live Amazon titles on 2026-08-13), so collagen COGS is
-- 5 x the invoice's per-piece price.
--
-- NOT included in these numbers: ocean freight and duty (the invoice is FOB
-- Shenzhen, so it carries none), FBA inbound placement, Amazon referral
-- fees, and FBA fulfilment fees. Gross profit in the Margins tab is
-- therefore before Amazon's cut — the tab says as much in its subtitle.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

-- ─── Collagen line — source A (2026 proforma invoice) ────────────────
--
--   SKU        invoice line          per piece   x5 = per 5-count
--   CWD-2X2    50x50mm   / 2x2 in       $2.00        $10.00
--   CWD-4X4    100x100mm / 4x4 in       $4.05        $20.25
--   CWD-PWD    Collagen Particles 1.0g  $4.52        $22.60
--
-- Movement against the first-order workbook: 2x2 -5.2%, 4x4 -4.3%,
-- powder +1.8%.
--
-- The invoice's fourth line — 178x178mm / 7.12x7.12in at $20.70/pc, 2,000
-- pieces, $41,400 — is deliberately absent. That size is discontinued and
-- migration 0008 drops the SKU. It was 73.9% of the invoice, so if any of
-- that stock actually lands it needs a home; nothing in this portal is
-- currently modelling it.
insert into public.inventory_state (sku, cogs)
values
  ('CWD-2X2', 10.00),
  ('CWD-4X4', 20.25),
  ('CWD-PWD', 22.60)
on conflict (sku) do update set cogs = excluded.cogs;

-- ─── Hydrocolloid and accessories — source B (first-order workbook) ──
--
-- Compression socks: the workbook's $2.704 bundles one free garment
-- cleanser ($0.154 of that). The standalone cleanser is now archived in
-- Shopify, but archiving the listing does not by itself end the in-box
-- giveaway, so the cost stays bundled here. If socks now ship without a
-- cleanser, this drops to $2.55 — worth $0.15/pair, about $460 across the
-- 3,000-pair position.
--
-- `cogs` is numeric(10,2), so $2.704 stores as $2.70 regardless — a 0.4c
-- per-unit understatement, roughly $12 across that same position. Called
-- out so it isn't rediscovered later as a reconciliation error.
--
-- CS-KHC-S-BLK is retired but keeps a cost so historical orders still price
-- out correctly.
insert into public.inventory_state (sku, cogs)
values
  ('HC-ROLL5FT',    1.65),
  ('HC-ROLL16FT',   3.03),
  ('CS-KHC-M-BLK',  2.70),
  ('CS-KHC-L-BLK',  2.70),
  ('CS-KHC-XL-BLK', 2.70),
  ('CS-KHC-S-BLK',  2.70),
  ('SOCK-AID',      1.80)
on conflict (sku) do update set cogs = excluded.cogs;

-- ─── Nothing left uncosted ───────────────────────────────────────────
--
-- The catalog is scoped to five product lines, and every SKU in it is
-- costed above. After this and 0008 run, COGS coverage goes from 0 of 17
-- SKUs to 10 of 10.
--
-- WOUND-WASH used to be costed here at $0.99 from the workbook's "Sterile
-- Saline Wound Wash 0.9% (box of 20)" line. It is out of scope now and 0008
-- deletes it, so the row is gone rather than orphaned. Worth knowing if it
-- ever comes back: the workbook prices it at $15.00 retail while the
-- catalog carried $17.99, so that match was never fully confirmed.

-- ─── Open pricing question this migration cannot answer ──────────────
--
-- CWD-PWD (B0H8N6Y5VW) had no buy box when checked live on 2026-08-13, so
-- it is unsellable until priced. Its $67.99 in the catalog is the
-- workbook's intended retail, not an observed one. The two collagen SKUs
-- that ARE priced sit at 2.72x-3.30x cost; $67.99 against $22.60 is 3.01x,
-- consistent with them.
