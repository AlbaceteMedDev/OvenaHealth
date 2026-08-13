-- Remove the 40 speculative sock variants left behind by 0004.
--
-- 0004 stopped DISPLAYING them by dropping them from js/data/inventory.js,
-- but never deleted the rows. inventory_state still held 50 SKUs when the
-- catalog had 10 — the extra 40 being the CS-KHC-S1..S5, CS-KHO-*, CS-THC-*
-- and CS-THO-* variants in beige and black that were seeded before the real
-- Amazon line-up was known.
--
-- Invisible in the portal, which reads the catalog, but they are real rows:
-- they show up in any direct query, in a `select *` export, and in anything
-- that counts SKUs straight off the table.
--
-- Verified inert before deleting, on 2026-08-13:
--
--   NOT in catalog ....... 40
--   their barcodes ........ 0
--   their aliases ......... 0
--   their amazon sales .... 0
--   any nonzero qty/cogs .. 0
--
-- So nothing cascades and no history is lost. Re-run that check before
-- trusting this migration on any other environment — it is written as a
-- keep-list, which is a blunt instrument if the catalog there differs.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

-- What would be removed. Expect 0 after this migration has run once.
select count(*) as rows_to_delete
from public.inventory_state
where sku not in (
  'HC-ROLL5FT', 'HC-ROLL16FT', 'CWD-2X2', 'CWD-4X4', 'CWD-PWD',
  'CS-KHC-M-BLK', 'CS-KHC-L-BLK', 'CS-KHC-XL-BLK', 'SOCK-AID', 'CS-KHC-S-BLK'
);

delete from public.inventory_state
where sku not in (
  'HC-ROLL5FT', 'HC-ROLL16FT', 'CWD-2X2', 'CWD-4X4', 'CWD-PWD',
  'CS-KHC-M-BLK', 'CS-KHC-L-BLK', 'CS-KHC-XL-BLK', 'SOCK-AID', 'CS-KHC-S-BLK'
);

-- Post-state, confirmed 2026-08-13: 10 rows, every one carrying a cogs, an
-- amazon_fee and exactly one -FBA alias.
