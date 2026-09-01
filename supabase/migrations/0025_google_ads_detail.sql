-- Google Ads detail: the bid keywords and the landing pages behind the spend.
--
-- The Keywords tab already carries SEARCH TERMS (what customers typed) for
-- both platforms. These two tables add the other half of the Google picture:
--
--   google_keywords_daily       what we BID on, with match type, campaign and
--                               ad group, plus quality score where Google
--                               gives one.
--   google_landing_pages_daily  which page the click actually landed on.
--
-- Campaigns are deliberately NOT duplicated here. ads_daily already holds
-- per-campaign spend for every platform and is synced every 30 minutes; a
-- second copy on a six-hourly schedule would disagree with it within the hour
-- and there would be no way to tell which was right.
--
-- WHY THE DIMENSION COLUMNS ARE NULLABLE-BY-DEFAULT-EMPTY
-- Google's API splits these into separate report VIEWS and Catchr rejects a
-- request outright ("invalid mapping") when fields from different views are
-- combined. Which combinations it accepts is not documented and cannot be
-- probed reliably, so the sync tries the richest dimension set first and
-- falls back to narrower ones. A row from a fallback shape is still real
-- data — it just has fewer dimensions filled — so campaign_name / ad_group /
-- match_type default to '' rather than being required. The sync records
-- which shape succeeded in sync_runs.detail.
--
-- Empty string, not NULL, because these belong to the primary key and
-- Postgres will not enforce uniqueness across NULLs.
--
-- Run once in Supabase Studio -> SQL Editor. Idempotent.
--
-- IMPORTANT: run the whole file. Migration 0021 was applied without its
-- policy statement, which left ads_search_terms readable only by the service
-- role and forced /api/search-terms to exist as a workaround. The policies at
-- the bottom of this file are not optional.

create table if not exists public.google_keywords_daily (
  date date not null,
  keyword text not null,
  match_type text not null default '',
  campaign_name text not null default '',
  ad_group_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric(12, 4) not null default 0,
  conversions numeric(12, 2) not null default 0,
  conversion_value numeric(12, 2) not null default 0,
  quality_score numeric(4, 1),
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (date, keyword, match_type, campaign_name, ad_group_name)
);

create index if not exists google_keywords_daily_date_idx
  on public.google_keywords_daily (date desc);
create index if not exists google_keywords_daily_cost_idx
  on public.google_keywords_daily (cost desc);

create table if not exists public.google_landing_pages_daily (
  date date not null,
  landing_page text not null,
  campaign_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric(12, 4) not null default 0,
  conversions numeric(12, 2) not null default 0,
  conversion_value numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (date, landing_page, campaign_name)
);

create index if not exists google_landing_pages_daily_date_idx
  on public.google_landing_pages_daily (date desc);
create index if not exists google_landing_pages_daily_cost_idx
  on public.google_landing_pages_daily (cost desc);

-- ─── Row level security ──────────────────────────────────────────────
alter table public.google_keywords_daily enable row level security;
alter table public.google_landing_pages_daily enable row level security;

drop policy if exists "auth read" on public.google_keywords_daily;
create policy "auth read" on public.google_keywords_daily
  for select to authenticated using (true);

drop policy if exists "auth read" on public.google_landing_pages_daily;
create policy "auth read" on public.google_landing_pages_daily
  for select to authenticated using (true);

-- ─── The policy migration 0021 never got ─────────────────────────────
-- ads_search_terms has been readable only by the service role since it was
-- created, which is why /api/search-terms exists. Creating it here lets the
-- browser read the table directly again; the endpoint can then be deleted.
alter table public.ads_search_terms enable row level security;
drop policy if exists "auth read" on public.ads_search_terms;
create policy "auth read" on public.ads_search_terms
  for select to authenticated using (true);
