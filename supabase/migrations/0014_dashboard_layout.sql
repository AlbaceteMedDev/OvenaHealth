-- Saved Overview layouts.
--
-- The Overview tab is now assembled from widgets the team picks rather than
-- a fixed page. This stores which widgets are shown and in what order.
--
-- One row per layout, keyed by name — 'overview' is the only one today, but
-- the key leaves room for saved views later without another migration.
--
-- Shared, not per-user, on purpose: everyone signs in through the single
-- team account (see TEAM_EMAIL in js/config.js), so a per-user layout would
-- be per-browser in practice and the team would silently see different
-- dashboards. One shared layout means "the number I'm looking at" is the
-- same number everyone else is looking at.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.

create table if not exists public.dashboard_layout (
  id         text primary key,
  widgets    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create or replace function public.set_dashboard_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists dashboard_layout_audit on public.dashboard_layout;
create trigger dashboard_layout_audit
  before insert or update on public.dashboard_layout
  for each row execute function public.set_dashboard_audit();

-- Same shared-workspace policy as the rest of the schema: any signed-in
-- session may read and write. No delete policy — layouts are replaced, and
-- resetting to default writes the default rather than removing the row.
alter table public.dashboard_layout enable row level security;

drop policy if exists "auth read" on public.dashboard_layout;
create policy "auth read" on public.dashboard_layout
  for select to authenticated using (true);

drop policy if exists "auth insert" on public.dashboard_layout;
create policy "auth insert" on public.dashboard_layout
  for insert to authenticated with check (true);

drop policy if exists "auth update" on public.dashboard_layout;
create policy "auth update" on public.dashboard_layout
  for update to authenticated using (true) with check (true);

-- No seed row. A missing row means "never customised", and the client falls
-- back to the default widget set in js/widgets.js. Seeding a copy here would
-- fork that default — change it in code and every install would still be
-- pinned to whatever this migration happened to write.
