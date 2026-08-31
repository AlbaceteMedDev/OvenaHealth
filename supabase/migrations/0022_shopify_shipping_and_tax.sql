-- Record what the storefront charged for postage and tax.
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.
--
-- WHY
-- shop_totals_daily held product revenue only. Customers paid $195.86 of
-- shipping between 2026-07-19 and 2026-08-30 that the portal never saw,
-- while the P&L charged outbound postage as a cost on every one of those
-- same orders — so the storefront was billed for shipping it had in fact
-- been paid for, and contribution read low by the whole amount.
--
-- Shipping is revenue and is added to the top line. Tax is NOT: it is
-- collected on the state's behalf and remitted, so it is stored only so the
-- storefront's deposits can be reconciled against the portal, and no widget
-- adds it to anything.
--
-- Both default to 0, so rows written before the sync started reporting them
-- read as "no postage recorded" rather than as null. The next full-window
-- Shopify sync rewrites every row in the table (it re-reads from DATA_START
-- and prunes), so the backfill is the sync itself — nothing to load by hand.

alter table public.shop_totals_daily
  add column if not exists shipping numeric(12, 2) not null default 0;

alter table public.shop_totals_daily
  add column if not exists taxes numeric(12, 2) not null default 0;

comment on column public.shop_totals_daily.shipping is
  'Postage charged to the customer, net of refunds and free-shipping discounts. Revenue.';

comment on column public.shop_totals_daily.taxes is
  'Sales tax collected, net of refunds. NOT revenue — collected and remitted.';
