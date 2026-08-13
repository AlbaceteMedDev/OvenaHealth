-- Stock on hand: warehouse quantities and FBA sellable.
--
-- Both columns have sat at 0 since 0001, so the Inventory tab showed an
-- empty warehouse and the Margins tab reported "Inventory at cost" of $0
-- despite there being real stock.
--
-- Corrects a wrong call in 0009, which declined to load these on the
-- grounds that /api/sync/fba would overwrite them. It would not:
-- api/sync/fba.mjs calls replaceAll("fba_inventory", ...) and never writes
-- inventory_state. These two columns are manual — nothing syncs them, so
-- nothing erases them either.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

-- ─── shopify_qty = warehouse ─────────────────────────────────────────
--
-- From "Ovena Retail Pricing and Profit Projection (first order).xlsx",
-- the In Stock column. Collagen is counted in 5-count retail units, which
-- is the unit the whole portal works in.
--
-- READ THIS BEFORE TRUSTING THE NUMBERS: these are as-ordered quantities
-- from the first order, not a live count. Since that workbook was written,
-- 203 units have sold and several thousand more have been shipped into FBA
-- (250 per sock size, 500 per hydro roll, 200 4x4, 80 each 2x2 and powder,
-- 650 sock aid). Whether the warehouse figure should be net of what has
-- already shipped to Amazon depends on how the workbook was counted, which
-- the file does not say. Treat this as a starting balance to correct in the
-- UI, not as truth.
--
-- CS-KHC-S-BLK and SOCK-AID are absent from the workbook's In Stock column
-- (it notes "Kits and Sock Aid excluded — no in-stock qty defined"), so
-- they are left at 0 rather than guessed.
insert into public.inventory_state (sku, shopify_qty)
values
  ('CWD-2X2',        377),
  ('CWD-4X4',        800),
  ('CWD-PWD',        320),
  ('CS-KHC-M-BLK',  1000),
  ('CS-KHC-L-BLK',  1000),
  ('CS-KHC-XL-BLK', 1000),
  ('HC-ROLL5FT',    1000),
  ('HC-ROLL16FT',   1000)
on conflict (sku) do update set shopify_qty = excluded.shopify_qty;

-- ─── amazon_qty = FBA sellable ───────────────────────────────────────
--
-- From Seller Central "Manage All Inventory", read 2026-08-13. Nine of the
-- ten SKUs were Out of Stock with 0 available; only the sock aid had
-- sellable units, at 100.
--
-- This is AVAILABLE stock, not inbound. The large inbound shipments listed
-- above are deliberately not added here — inbound is not sellable, and
-- counting it as on-hand would suppress exactly the low-stock alerts that
-- matter right now. There is no inbound column in this schema; if that
-- distinction needs to survive, it wants a real column rather than being
-- folded into this one.
insert into public.inventory_state (sku, amazon_qty)
values
  ('SOCK-AID',       100),
  ('CWD-2X2',          0),
  ('CWD-4X4',          0),
  ('CWD-PWD',          0),
  ('CS-KHC-M-BLK',     0),
  ('CS-KHC-L-BLK',     0),
  ('CS-KHC-XL-BLK',    0),
  ('CS-KHC-S-BLK',     0),
  ('HC-ROLL5FT',       0),
  ('HC-ROLL16FT',      0)
on conflict (sku) do update set amazon_qty = excluded.amazon_qty;
