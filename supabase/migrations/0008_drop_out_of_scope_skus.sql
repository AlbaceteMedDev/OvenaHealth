-- Scope the catalog to five product lines.
--
-- As of 2026-08-13 the portal tracks compression socks, hydrocolloid rolls,
-- the sock aid, collagen powder, and the 2x2 / 4x4 collagen dressings.
-- Everything else comes out. `js/data/inventory.js` no longer carries any of
-- the SKUs below; this removes their inventory_state rows so the database
-- and the catalog agree.
--
-- Collagen care kits are NOT added here — not carried yet. Deliberately no
-- placeholder row: a SKU with no stock and no cost drags COGS coverage down
-- and shows up as a phantom in reorder alerts.
--
-- CASCADE WARNING: barcodes.sku and amazon_sku_map.sku both carry
--   references public.inventory_state(sku) on delete cascade
-- so this also removes any warehouse barcode and any Amazon seller-SKU alias
-- registered against these SKUs. The select below reports what will go
-- before the delete runs — read its output before scrolling past it.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

-- ─── What is being removed and why ───────────────────────────────────
--
--   CWD-7X7      7"x7" collagen dressing, ASIN B0HDCQ2LJF — discontinued.
--                Never sold a unit, so nothing historical is lost.
--   SFD-4X4      Silicone foam dressings. Note these are NOT the collagen
--   SFD-6X6      4x4 (CWD-4X4, which stays) — different product, same
--   SFD-8X8      size in the name.
--   GAUZE-ROLL   Gauze rolls
--   GLOVE-DISP   Disposable gloves
--   WOUND-WASH   Sterile saline wound wash
--
-- The last five were warehouse-only: never listed on Amazon, no ASIN, and
-- no cost in any source document.
--
-- Retiring rather than deleting is the right move for a SKU with sales
-- history — CS-KHC-S-BLK stays for exactly that reason, and it stays in
-- scope anyway as part of the compression sock line. None of the SKUs below
-- has any.

-- What is about to be removed. Expect 7 inventory_state rows and 0 of the
-- rest; anything else means one of these picked up dependents worth keeping.
with doomed(sku) as (
  values ('CWD-7X7'), ('SFD-4X4'), ('SFD-6X6'), ('SFD-8X8'),
         ('GAUZE-ROLL'), ('GLOVE-DISP'), ('WOUND-WASH')
)
select 'inventory_state' as tbl, count(*) from public.inventory_state where sku in (select sku from doomed)
union all
select 'barcodes',            count(*) from public.barcodes            where sku in (select sku from doomed)
union all
select 'amazon_sku_map',      count(*) from public.amazon_sku_map      where sku in (select sku from doomed);

delete from public.inventory_state
where sku in ('CWD-7X7', 'SFD-4X4', 'SFD-6X6', 'SFD-8X8',
              'GAUZE-ROLL', 'GLOVE-DISP', 'WOUND-WASH');

-- Leaves exactly 10 SKUs: 9 stocked plus CS-KHC-S-BLK retired.

-- ─── Discontinued elsewhere, for the record ──────────────────────────
--
-- No portal rows to clean up for these — none was ever an Amazon catalog
-- SKU. All three are Shopify-only products, and all three were already
-- ARCHIVED in Shopify on 2026-08-12, before this migration was written:
--
--   pH-Balanced Compression Garment Cleanser  compression-cleanser    COMP-CLNSR
--   Compression Care Kit                      compression-care-kit    BUNDLE-CARE-*
--   Compression Starter Kit                   compression-starter-kit BUNDLE-COMP-*
--
-- Their historical rows in shop_sales_daily stay put. That table is the
-- record of what the storefront actually sold, and the Shopify tab reads
-- net-of-refunds from it; deleting history would silently change past
-- totals.
