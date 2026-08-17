-- Storefront traffic by acquisition source, for SEO tracking.
--
-- Shopify's own analytics answer "where did visitors come from" through
-- ShopifyQL (FROM sessions ... GROUP BY day, referrer_source), which needs
-- read_analytics — a scope the app only gained on 2026-08-17. This stores
-- the daily result so the portal can trend it rather than re-querying, and
-- so history survives Shopify's own retention window.
--
-- referrer_source values seen so far: direct, search, social, email, unknown.
-- "search" is the SEO number — organic entrances from search engines.
-- Shopify does not break that down by engine or keyword; Search Console is
-- the only source for query-level data, and it is a separate integration.

create table if not exists public.seo_sessions_daily (
  date             date not null,
  referrer_source  text not null,
  sessions         integer not null default 0 check (sessions >= 0),
  synced_at        timestamptz not null default now(),
  primary key (date, referrer_source)
);

create index if not exists seo_sessions_daily_date_idx
  on public.seo_sessions_daily (date desc);

alter table public.seo_sessions_daily enable row level security;

drop policy if exists "auth read" on public.seo_sessions_daily;
create policy "auth read" on public.seo_sessions_daily
  for select to authenticated using (true);
