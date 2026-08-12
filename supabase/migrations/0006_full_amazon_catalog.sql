-- The Amazon catalog is wider than the Sales & Traffic report revealed.
--
-- That report only returns SKUs with activity, so the collagen line was
-- invisible: those listings have sessions but no sales yet. ASINs and prices
-- below were read off the live listings on 2026-08-12.
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.

-- Currently stocked and live on Amazon.com.
insert into public.inventory_state (sku, asin, listed, marketplace_id, reorder_level)
values
  ('HC-ROLL5FT',    'B0H8ZH3J9R', true, 'ATVPDKIKX0DER', 120),
  ('HC-ROLL16FT',   'B0H949P7JW', true, 'ATVPDKIKX0DER',  90),
  ('CWD-2X2',       'B0HDCRM2WW', true, 'ATVPDKIKX0DER',  60),
  ('CWD-4X4',       'B0HDCGJSK6', true, 'ATVPDKIKX0DER',  50),
  ('CWD-PWD',       'B0H8N6Y5VW', true, 'ATVPDKIKX0DER',  75),
  ('CS-KHC-M-BLK',  'B0H8ZVQPPB', true, 'ATVPDKIKX0DER',  45),
  ('CS-KHC-L-BLK',  'B0H8ZJPGL8', true, 'ATVPDKIKX0DER',  60),
  ('CS-KHC-XL-BLK', 'B0H8ZQQB4F', true, 'ATVPDKIKX0DER',  40),
  ('SOCK-AID',      'B0HC5X78B1', true, 'ATVPDKIKX0DER',  25)
on conflict (sku) do update
  set asin           = excluded.asin,
      listed         = true,
      marketplace_id = excluded.marketplace_id;

-- Listed but no longer carried. Reorder level drops to 0 so they stop
-- raising low-stock alerts, but the rows stay so historical orders still
-- resolve to a product instead of an unknown SKU.
insert into public.inventory_state (sku, asin, listed, marketplace_id, reorder_level)
values
  ('CS-KHC-S-BLK', 'B0H8ZT6Y7B', true, 'ATVPDKIKX0DER', 0),
  ('CWD-7X7',      'B0HDCQ2LJF', true, 'ATVPDKIKX0DER', 0)
on conflict (sku) do update
  set asin           = excluded.asin,
      listed         = true,
      marketplace_id = excluded.marketplace_id,
      reorder_level  = 0;

-- Backfill ASINs onto any sales rows that landed before the catalog knew
-- them, so per-product reporting stitches together across the whole window.
update public.amz_sales_daily s
   set sku = i.sku
  from public.inventory_state i
 where s.sku is null
   and s.asin is not null
   and i.asin = s.asin;

update public.ads_sku_daily a
   set sku = i.sku
  from public.inventory_state i
 where a.sku is null
   and a.asin is not null
   and i.asin = a.asin;
