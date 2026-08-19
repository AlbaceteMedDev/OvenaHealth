-- What people actually typed before they saw an Ovena ad, per platform.
--
-- One row per (day, platform, search term, keyword, match type, campaign).
-- Search TERMS are the customer's words; KEYWORDS are what we bid on. They
-- are not the same thing and the tab shows both, because the gap between
-- them is where wasted spend lives.
--
-- The two connectors do NOT expose the same shape, and the columns reflect
-- that honestly rather than inventing parity:
--
--   Amazon Ads  date + searchTerm + keyword + matchType + campaignName,
--               with real attributed sales, orders and units.
--   Google Ads  date + Query ONLY. Catchr rejects the request outright
--               ("invalid mapping") if campaign, match type or the matched
--               keyword is added — the search-term view cannot be joined to
--               the keyword view. So keyword/match_type/campaign_name stay
--               empty for Google, which is why they default to '' rather
--               than being NOT NULL with a fake value.
--
-- Empty string, not NULL, because all six belong to the primary key and
-- Postgres will not enforce uniqueness across NULLs.
--
-- Run once in Supabase Studio → SQL Editor. Idempotent.

create table if not exists public.ads_search_terms (
  date date not null,
  platform text not null,
  search_term text not null,
  keyword text not null default '',
  match_type text not null default '',
  campaign_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric(12, 4) not null default 0,
  -- Sales/orders/units are each platform's OWN attribution, not the
  -- portal's. Amazon reports 14-day click-attributed figures; Google reports
  -- whatever its conversion tracking is configured to count. They are not
  -- comparable across platforms and the tab says so.
  sales numeric(12, 2) not null default 0,
  orders numeric(12, 2) not null default 0,
  units numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (date, platform, search_term, keyword, match_type, campaign_name)
);

create index if not exists ads_search_terms_platform_date_idx
  on public.ads_search_terms (platform, date desc);
create index if not exists ads_search_terms_cost_idx
  on public.ads_search_terms (cost desc);

alter table public.ads_search_terms enable row level security;

drop policy if exists "auth read" on public.ads_search_terms;
create policy "auth read" on public.ads_search_terms
  for select to authenticated using (true);
