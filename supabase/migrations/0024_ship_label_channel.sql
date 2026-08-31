-- Which channel each shipping label belongs to.
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.
--
-- WHY
-- Migration 0023 charged the postage actually bought, which fixed the total
-- and hid the thing that matters. Postage is not one cost: the storefront
-- charges the customer for shipping and Amazon merchant-fulfilled orders do
-- not. Measured over 2026-07-22..08-26:
--
--   storefront    18 labels    $162.93 paid, $120.00 charged   ≈ break-even
--   Amazon FBM   140 labels  $1,322.51 paid,  $27.70 charged   ≈ all cost
--
-- So a single "outbound shipping" line said the storefront was expensive to
-- ship for when it very nearly pays for itself, and buried the $1,295 of
-- unrecovered postage on merchant-fulfilled Amazon orders — which is the
-- actual finding, and the reason FBM volume is worth managing.
--
-- HOW A LABEL IS ATTRIBUTED
-- The export has no order id, so the destination postcode is the join: a
-- label whose postcode matches a merchant-fulfilled amz_orders row is
-- Amazon's. It is stored rather than derived on every render because the
-- match needs the whole order history, not the window being viewed.
--
-- Postcodes are not unique to an order, so this is an attribution and not a
-- proof. It is checkable, which the old average never was: `channel` and
-- `postal_code` are both kept, so a re-import re-derives it and any label
-- can be traced back to the address it went to.

alter table public.ship_labels
  add column if not exists postal_code text;

-- 'amazon_fbm' | 'storefront' | 'excluded'
alter table public.ship_labels
  add column if not exists channel text;

create index if not exists ship_labels_channel_idx
  on public.ship_labels (channel);

comment on column public.ship_labels.postal_code is
  'Destination postcode, 5 chars. The only join back to an order.';

comment on column public.ship_labels.channel is
  'amazon_fbm (postcode matches a merchant-fulfilled Amazon order), storefront, or excluded (another business''s postage).';
