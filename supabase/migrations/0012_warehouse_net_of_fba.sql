-- Warehouse = total purchased, less everything Amazon is holding, less units sold.
--
-- 0011 loaded the first-order workbook's "In Stock" column straight into
-- shopify_qty. That column is total units PURCHASED, not warehouse stock —
-- it includes units already shipped to Amazon and units already sold. This
-- nets those out so shopify_qty means what the schema says it means: stock
-- at the warehouse, available to ship.
--
--   warehouse = purchased − (FBA inbound + FBA on-hand) − units sold
--
-- Sources
--   purchased    first-order pricing workbook, plus the Gaixie (sock aid)
--                and YOJO (hydrocolloid) payment invoices.
--   FBA          Seller Central "Manage All Inventory", read 2026-08-13.
--   units sold   amz_sales_daily, 2026-07-22 to 2026-08-11.
--
--   SKU            purchased   FBA   sold   = warehouse
--   CWD-2X2              377    80      0          297
--   CWD-4X4              800   200      0          600
--   CWD-PWD              320    80      0          240
--   CS-KHC-M-BLK        1000   250     20          730
--   CS-KHC-L-BLK        1000   250     36          714
--   CS-KHC-XL-BLK       1000   250     16          734
--   HC-ROLL5FT          1000   500     79          421
--   HC-ROLL16FT         1000   500     42          458
--   SOCK-AID            2000   750      6         1244
--
-- The hydrocolloid invoice independently confirms the workbook: 1,000 of
-- each roll, matching its In Stock column exactly.
--
-- SOCK-AID is the only SKU where Amazon holds sellable units (100 on-hand
-- plus 650 inbound = 750), so it is the only row where on-hand matters.
-- Everywhere else FBA on-hand is 0 and the subtraction is inbound alone.
--
-- CS-KHC-S-BLK stays at 0: there is no purchase document for it anywhere.
-- The workbook lists M, L and XL only. 0 here means "no record", not
-- "counted and found empty" — it is retired, so it raises no reorder alert.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

insert into public.inventory_state (sku, shopify_qty)
values
  ('CWD-2X2',        297),
  ('CWD-4X4',        600),
  ('CWD-PWD',        240),
  ('CS-KHC-M-BLK',   730),
  ('CS-KHC-L-BLK',   714),
  ('CS-KHC-XL-BLK',  734),
  ('CS-KHC-S-BLK',     0),
  ('HC-ROLL5FT',     421),
  ('HC-ROLL16FT',    458),
  ('SOCK-AID',      1244)
on conflict (sku) do update set shopify_qty = excluded.shopify_qty;

-- amazon_qty is left as 0011 set it — 100 for SOCK-AID, 0 elsewhere, from
-- Seller Central's Available column. It never overlapped with the warehouse
-- figure and needs no correction.

-- ─── Unit costs disagree with the invoices — NOT changed here ────────
--
-- Both payment invoices price these SKUs differently from the workbook
-- costs loaded in 0007:
--
--   SKU           workbook (0007)   invoice     invoice source
--   SOCK-AID              $1.80      $1.70      Gaixie, 2,000 pcs $3,400
--   HC-ROLL5FT            $1.65      $1.48      YOJO,   1,000 pcs $1,480
--   HC-ROLL16FT           $3.03      $3.20      YOJO,   1,000 pcs $3,200
--
-- Freight does not explain the gap: adding the workbook's own shipping
-- ($0.321 and $0.589) to the invoice prices gives $1.80 and $3.79, which
-- matches neither set. The sock aid invoice carries $475 freight on 2,000
-- pieces, a landed $1.9375.
--
-- COGS is left on the workbook basis so every SKU stays on one consistent
-- footing. Switching to invoice pricing is a real decision — it moves gross
-- margin on three SKUs — and wants to be made deliberately, not folded into
-- a quantity migration.
--
-- Also worth knowing: both invoices read "Waiting for supplier to ship",
-- yet Amazon already holds stock of both products and both have sold. So
-- these documents cover a replenishment round, and the quantities above are
-- reconciled against the workbook rather than added to it.
