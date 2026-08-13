-- Per-unit inbound shipping, so the Overview can show a full cost stack.
--
-- Revenue, Amazon fees and COGS were all already stored. Shipping was the
-- one cost line with nowhere to live, which meant any "what did this
-- actually cost us" breakdown was silently missing a component.
--
-- numeric(10,4), not (10,2) like cogs: these are cents-per-unit figures and
-- rounding $0.0900 to $0.09 is fine, but rounding $0.2375 to $0.24 across
-- thousands of units is not. Learn from cogs, which rounds the socks' real
-- $2.704 to $2.70.
--
-- Source: the first-order pricing workbook's Shipping column, except the
-- sock aid, which the workbook omits — that one is the Gaixie invoice's
-- $475 freight over 2,000 pieces.
--
--   CWD-2X2         $0.5270
--   CWD-4X4         $1.0580
--   CWD-PWD         $1.1090
--   CS-KHC-*        $0.0900   includes the bundled cleanser's share
--   HC-ROLL5FT      $0.3210
--   HC-ROLL16FT     $0.5890
--   SOCK-AID        $0.2375   $475 / 2,000, from the invoice
--
-- Note this is inbound freight to the warehouse only. It is NOT Amazon's
-- outbound fulfilment — that already sits inside amazon_fee.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

alter table public.inventory_state
  add column if not exists ship_cost numeric(10, 4) not null default 0
  check (ship_cost >= 0);

comment on column public.inventory_state.ship_cost is
  'Inbound freight per retail unit, to the warehouse. Excludes Amazon '
  'fulfilment, which is part of amazon_fee. 0 means not recorded.';

insert into public.inventory_state (sku, ship_cost)
values
  ('CWD-2X2',       0.5270),
  ('CWD-4X4',       1.0580),
  ('CWD-PWD',       1.1090),
  ('CS-KHC-M-BLK',  0.0900),
  ('CS-KHC-L-BLK',  0.0900),
  ('CS-KHC-XL-BLK', 0.0900),
  ('CS-KHC-S-BLK',  0.0900),
  ('HC-ROLL5FT',    0.3210),
  ('HC-ROLL16FT',   0.5890),
  ('SOCK-AID',      0.2375)
on conflict (sku) do update set ship_cost = excluded.ship_cost;
