-- Amazon's cut per unit, and the -FBA seller SKU aliases.
--
-- Both come from the Seller Central "Manage All Inventory" view, read
-- 2026-08-13. Prices there match js/data/inventory.js exactly for all ten
-- SKUs, so no retail price changes: $67.99 / $32.99 / $55.00 / $14.99 /
-- $22.49 x4 / $8.99 / $14.39.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent. Run after 0008.

-- ─── Seller SKU aliases ──────────────────────────────────────────────
--
-- Every seller SKU is the catalog SKU plus "-FBA". Only CS-KHC-L-BLK-FBA
-- was ever registered, so the other nine relied on resolveSku()'s ASIN
-- fallback. That works while every Amazon report carries an ASIN and fails
-- silently the moment one doesn't — a sale would land as an unresolved SKU
-- and drop out of per-product reporting.
insert into public.amazon_sku_map (amazon_sku, sku)
values
  ('CWD-2X2-FBA',       'CWD-2X2'),
  ('CWD-4X4-FBA',       'CWD-4X4'),
  ('CWD-PWD-FBA',       'CWD-PWD'),
  ('HC-ROLL5FT-FBA',    'HC-ROLL5FT'),
  ('HC-ROLL16FT-FBA',   'HC-ROLL16FT'),
  ('CS-KHC-M-BLK-FBA',  'CS-KHC-M-BLK'),
  ('CS-KHC-L-BLK-FBA',  'CS-KHC-L-BLK'),
  ('CS-KHC-XL-BLK-FBA', 'CS-KHC-XL-BLK'),
  ('CS-KHC-S-BLK-FBA',  'CS-KHC-S-BLK'),
  ('SOCK-AID-FBA',      'SOCK-AID')
on conflict (amazon_sku) do update set sku = excluded.sku;

-- ─── Amazon fees per unit sold ───────────────────────────────────────
--
-- The Margins tab has always said gross profit is before Amazon's cut.
-- This is that cut, so net margin can finally be computed.
--
--   SKU            price   total fees   of which FBA   net margin
--   CWD-2X2       $32.99        $4.52          $3.86        56.0%
--   CWD-4X4       $55.00        $7.11          $4.36        50.3%
--   CWD-PWD       $67.99        $5.49          $4.13        58.7%
--   HC-ROLL5FT     $8.99        $3.01          $3.01        48.2%
--   HC-ROLL16FT   $14.39        $4.81          $4.09        45.5%
--   CS-KHC-*      $22.49        $6.23          $4.66        60.3%
--   SOCK-AID      $14.99        $5.97          $5.22        48.2%
--
-- Treat these as Amazon's own estimate, not a derived figure. The residual
-- after subtracting the FBA fee does not reconcile to any single referral
-- rate — it implies 2% on the 2x2, 5% on the 4x4, 7% on the socks and 0% on
-- the 5 ft roll, which is not how referral fees work. Whatever that view is
-- summing, it is the number Amazon shows for fees per unit sold, so it is
-- the number stored. Worth a look in the fee preview report before anyone
-- prices off it to the cent.
alter table public.inventory_state
  add column if not exists amazon_fee numeric(10, 2) not null default 0
  check (amazon_fee >= 0);

comment on column public.inventory_state.amazon_fee is
  'Total Amazon fees per unit sold (referral + FBA), from Seller Central''s '
  'estimated fees column. 0 means not recorded, not fee-free.';

insert into public.inventory_state (sku, amazon_fee)
values
  ('CWD-2X2',       4.52),
  ('CWD-4X4',       7.11),
  ('CWD-PWD',       5.49),
  ('HC-ROLL5FT',    3.01),
  ('HC-ROLL16FT',   4.81),
  ('CS-KHC-M-BLK',  6.23),
  ('CS-KHC-L-BLK',  6.23),
  ('CS-KHC-XL-BLK', 6.23),
  ('CS-KHC-S-BLK',  6.23),
  ('SOCK-AID',      5.97)
on conflict (sku) do update set amazon_fee = excluded.amazon_fee;

-- ─── Not loaded here on purpose ──────────────────────────────────────
--
-- That same view shows nine of ten SKUs Out of Stock with large inbound
-- quantities (500 + 500 hydro rolls, 250 per sock size, 650 sock aid, 200
-- 4x4, 80 each 2x2 and powder; only the sock aid has sellable on-hand, at
-- 100). Those are inbound, not on-hand, and /api/sync/fba overwrites
-- fba_inventory wholesale on every run — hand-loading a snapshot here would
-- be erased the first time it runs. It belongs to the sync, not to a
-- migration.
