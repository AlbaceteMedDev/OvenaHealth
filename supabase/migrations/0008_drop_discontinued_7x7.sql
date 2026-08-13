-- Drop the 7" x 7" collagen dressing.
--
-- CWD-7X7 (ASIN B0HDCQ2LJF) is discontinued as of 2026-08-13. It was
-- seeded by 0001 and re-asserted by 0006, and js/data/inventory.js no
-- longer carries it.
--
-- Safe to delete rather than retire: the collagen line has never recorded a
-- sale, so no row in amz_sales_daily or ads_sku_daily points at this SKU
-- and nothing historical is lost. (Retiring is the right move for a SKU
-- with sales history — CS-KHC-S-BLK stays for exactly that reason.)
--
-- CASCADE WARNING: barcodes.sku and amazon_sku_map.sku both carry
--   references public.inventory_state(sku) on delete cascade
-- so this also removes any warehouse barcode and any Amazon seller-SKU
-- alias registered against CWD-7X7. Neither is expected to exist — the
-- select below reports what will go before the delete runs, so check its
-- output if you care.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

-- What is about to be removed. Expect 1 inventory_state row and 0 of the
-- rest; anything else means the SKU picked up dependents worth keeping.
select 'inventory_state' as tbl, count(*) from public.inventory_state where sku = 'CWD-7X7'
union all
select 'barcodes',            count(*) from public.barcodes            where sku = 'CWD-7X7'
union all
select 'amazon_sku_map',      count(*) from public.amazon_sku_map      where sku = 'CWD-7X7';

delete from public.inventory_state where sku = 'CWD-7X7';

-- Discontinued alongside it, for the record — no portal rows to clean up
-- because none of these were ever Amazon catalog SKUs. All three are
-- Shopify-only products and all three were already ARCHIVED in Shopify on
-- 2026-08-12, before this migration was written:
--
--   pH-Balanced Compression Garment Cleanser  compression-cleanser    COMP-CLNSR
--   Compression Care Kit                      compression-care-kit    BUNDLE-CARE-*
--   Compression Starter Kit                   compression-starter-kit BUNDLE-COMP-*
--
-- Their historical rows in shop_sales_daily stay put. That table is the
-- record of what the storefront actually sold, and the Shopify tab reads
-- net-of-refunds from it; deleting history would silently change past
-- totals.
