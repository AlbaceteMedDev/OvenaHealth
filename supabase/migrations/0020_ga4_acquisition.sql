-- GA4 acquisition: the channel and landing-page detail Shopify cannot see.
--
-- Shopify's own analytics bucket every visit into five coarse sources —
-- direct, search, social, email, unknown. GA4 resolves the same window into
-- ten channels and disagrees on the totals, because it counts sessions on
-- its own definition and sees traffic Shopify's referrer logic misses:
--
--   Shopify        425 sessions, "search" = 72
--   GA4            510 sessions, Organic Search = 123, and separately
--                  Organic Shopping 47, Paid Search 28, Referral 54,
--                  Organic Social 4, AI Assistant 5, Paid Social 1
--
-- Neither is wrong; they measure differently. Both are kept rather than one
-- replacing the other, so a disagreement stays visible instead of being
-- resolved by whichever table happened to be queried. Shopify remains the
-- storefront's own account of itself; GA4 is the acquisition breakdown.
--
-- GA4 is NOT a substitute for Search Console. It reports the CHANNEL a visit
-- came through, never the query that produced it — organicGoogleSearchClicks
-- and friends exist in the GA4 schema but only populate once a Search
-- Console property is linked, which is the thing still outstanding.

-- ─── By acquisition channel ──────────────────────────────────────────
create table if not exists public.ga_channels_daily (
  date             date not null,
  property_id      text not null,
  channel_group    text not null,
  sessions         integer not null default 0,
  engaged_sessions integer not null default 0,
  active_users     integer not null default 0,
  new_users        integer not null default 0,
  -- GA4 renamed these "key events"; the API field is still `conversions`.
  conversions      numeric(12,2) not null default 0,
  purchase_revenue numeric(12,2) not null default 0,
  synced_at        timestamptz not null default now(),
  primary key (date, property_id, channel_group)
);

create index if not exists ga_channels_daily_date_idx
  on public.ga_channels_daily (date desc);

alter table public.ga_channels_daily enable row level security;
drop policy if exists "auth read" on public.ga_channels_daily;
create policy "auth read" on public.ga_channels_daily
  for select to authenticated using (true);

-- ─── By landing page ─────────────────────────────────────────────────
-- Which page a session STARTED on, which is how the storefront's 23 guide
-- pages and 7 hub pages get judged on whether they earn anything. Stored
-- with the query string as GA4 reports it: stripping it here would merge
-- distinct campaign landings that should stay apart.
create table if not exists public.ga_landing_pages_daily (
  date             date not null,
  property_id      text not null,
  landing_page     text not null,
  sessions         integer not null default 0,
  engaged_sessions integer not null default 0,
  conversions      numeric(12,2) not null default 0,
  purchase_revenue numeric(12,2) not null default 0,
  synced_at        timestamptz not null default now(),
  primary key (date, property_id, landing_page)
);

create index if not exists ga_landing_pages_daily_date_idx
  on public.ga_landing_pages_daily (date desc);
create index if not exists ga_landing_pages_daily_sessions_idx
  on public.ga_landing_pages_daily (sessions desc);

alter table public.ga_landing_pages_daily enable row level security;
drop policy if exists "auth read" on public.ga_landing_pages_daily;
create policy "auth read" on public.ga_landing_pages_daily
  for select to authenticated using (true);
