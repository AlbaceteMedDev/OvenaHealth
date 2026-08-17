-- The cost lines the P&L was still missing.
--
-- It already carried Amazon's fees, COGS and inbound freight to the
-- warehouse. Three real costs were absent, so contribution was flattering:
--
--   1. Outbound shipping — warehouse to customer. Applies to Shopify orders
--      only. Amazon FBA orders are already picked, packed and shipped inside
--      the FBA fee, so charging outbound again would double count them.
--   2. Payment processing — Shopify Payments takes a percentage plus a flat
--      amount per transaction. Amazon's cut is inside its referral fee.
--   3. FBA storage — a monthly charge for holding stock, not a per-unit one.
--
-- Per-unit values live on inventory_state next to cogs and ship_cost.
-- Store-wide rates live in one row of store_costs, because a percentage of
-- a transaction is not a property of a SKU.
--
-- Everything defaults to 0 and 0 means NOT RECORDED, not free. The P&L says
-- so rather than quietly reporting a cost of nothing — a shipping line
-- reading $0.00 is a lie that looks like a fact.

alter table public.inventory_state
  add column if not exists ship_to_customer numeric(10, 4) not null default 0
  check (ship_to_customer >= 0);

comment on column public.inventory_state.ship_to_customer is
  'Outbound shipping per unit, warehouse to customer. Shopify orders only — '
  'FBA orders already pay fulfilment inside amazon_fee. 0 means not recorded.';

create table if not exists public.store_costs (
  id                 text primary key default 'default',
  payment_fee_pct    numeric(6, 4) not null default 0 check (payment_fee_pct >= 0),
  payment_fee_flat   numeric(10, 4) not null default 0 check (payment_fee_flat >= 0),
  fba_storage_month  numeric(10, 2) not null default 0 check (fba_storage_month >= 0),
  updated_at         timestamptz not null default now()
);

comment on table public.store_costs is
  'Store-wide rates that are not per-SKU. payment_fee_pct is a fraction '
  '(0.029 = 2.9%), applied to Shopify net sales; payment_fee_flat is per order.';

insert into public.store_costs (id) values ('default') on conflict (id) do nothing;

alter table public.store_costs enable row level security;

drop policy if exists "auth read" on public.store_costs;
create policy "auth read" on public.store_costs for select to authenticated using (true);

drop policy if exists "auth write" on public.store_costs;
create policy "auth write" on public.store_costs
  for update to authenticated using (true) with check (true);
