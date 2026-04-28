-- Add Collagen Powder to the catalog. Idempotent — safe to re-run.

insert into public.inventory_state (sku, reorder_level)
values ('CWD-PWD', 75)
on conflict (sku) do nothing;
