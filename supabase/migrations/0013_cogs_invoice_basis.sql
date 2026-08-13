-- Move three SKUs onto invoice-priced COGS.
--
-- 0007 costed the non-collagen line from the first-order pricing workbook
-- because that was the only source. The supplier payment invoices are the
-- primary document and disagree with it:
--
--   SKU            workbook   invoice   source
--   SOCK-AID          $1.80     $1.70   Gaixie Plastic, 2,000 pcs, $3,400
--   HC-ROLL5FT        $1.65     $1.48   Nantong YOJO,   1,000 pcs, $1,480
--   HC-ROLL16FT       $3.03     $3.20   Nantong YOJO,   1,000 pcs, $3,200
--
-- Freight is deliberately excluded, keeping these on the same footing as
-- the collagen line, which is costed from an FOB Shenzhen invoice and so
-- carries no freight either. For reference, the sock aid invoice adds $475
-- of shipping across 2,000 pieces — a landed $1.9375. If COGS is ever moved
-- to a landed basis it has to move for every SKU at once, not just the ones
-- whose freight happens to be documented.
--
-- Effects, all recomputed rather than estimated:
--
--   net margin   SOCK-AID     48.2% -> 48.8%
--                HC-ROLL5FT   48.2% -> 50.1%
--                HC-ROLL16FT  45.5% -> 44.3%
--
--   inventory at cost   $30,926.19 -> $30,798.08   (-$128.11)
--   COGS on the 203 units sold to date  $473.61 -> $466.72   (-$6.89)
--
-- The collagen line is untouched: its costs already come from an invoice
-- (Foryou PO FY-PIUS009000-0001A), not from the workbook.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

insert into public.inventory_state (sku, cogs)
values
  ('SOCK-AID',    1.70),
  ('HC-ROLL5FT',  1.48),
  ('HC-ROLL16FT', 3.20)
on conflict (sku) do update set cogs = excluded.cogs;
