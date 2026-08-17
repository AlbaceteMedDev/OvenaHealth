-- Google Search Console: the query-level SEO data Shopify cannot provide.
--
-- The SEO tab so far reports Shopify's own sessions bucketed by
-- referrer_source, where every organic visit collapses into one bucket
-- called "search" — 72 sessions in the current window and nothing about how
-- anyone found the store. Search Console is the only source for what was
-- actually typed, where the listing ranked, and how often it was seen but
-- not clicked.
--
-- Two tables rather than one, because the two questions have different
-- shapes and very different row counts. Queries fan out fast — a month can
-- be thousands of distinct phrases, most with a single impression — while
-- pages stay small and bounded. Keeping them apart means a page-level chart
-- does not have to scan the query long tail.

-- ─── By search query ─────────────────────────────────────────────────
-- position is an AVERAGE rank over the day, so it cannot be summed. Any
-- roll-up across days has to weight it by impressions; storing impressions
-- alongside is what makes that possible.
create table if not exists public.seo_queries_daily (
  date         date not null,
  site_url     text not null,
  query        text not null,
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  position     numeric(8,2) not null default 0,
  synced_at    timestamptz not null default now(),
  primary key (date, site_url, query)
);

create index if not exists seo_queries_daily_date_idx
  on public.seo_queries_daily (date desc);
-- Ordering the long tail by clicks is the common read.
create index if not exists seo_queries_daily_clicks_idx
  on public.seo_queries_daily (clicks desc);

alter table public.seo_queries_daily enable row level security;
drop policy if exists "auth read" on public.seo_queries_daily;
create policy "auth read" on public.seo_queries_daily
  for select to authenticated using (true);

-- ─── By landing page ─────────────────────────────────────────────────
-- Which pages Google actually sends people to, which is how the storefront's
-- 23 guide pages and 7 hub pages get judged on whether they earn anything.
create table if not exists public.seo_pages_daily (
  date         date not null,
  site_url     text not null,
  page_path    text not null,
  clicks       integer not null default 0,
  impressions  integer not null default 0,
  position     numeric(8,2) not null default 0,
  synced_at    timestamptz not null default now(),
  primary key (date, site_url, page_path)
);

create index if not exists seo_pages_daily_date_idx
  on public.seo_pages_daily (date desc);

alter table public.seo_pages_daily enable row level security;
drop policy if exists "auth read" on public.seo_pages_daily;
create policy "auth read" on public.seo_pages_daily
  for select to authenticated using (true);
