// SEO — where storefront visitors come from, and how much of that is earned.
//
// Split out of the Shopify tab, where it had been three widgets competing
// with revenue for attention. Traffic acquisition and storefront revenue are
// different questions on different time horizons, and the SEO numbers were
// always the ones being scrolled past.
//
// Scope is the SEO group alone. Shopify's own sales widgets are deliberately
// NOT available here: this tab answers "did anyone arrive", not "did anyone
// buy", and mixing the two invites reading a good traffic day as a good
// revenue day.
//
// Three sources, deliberately side by side rather than merged:
//
//   Shopify   its own account of itself — five coarse referrer buckets
//   GA4       ten acquisition channels, engagement, conversions, revenue
//   Search    the actual queries, rank and impressions
//   Console
//
// Shopify and GA4 disagree on totals (425 against 510 in the same window)
// because they count sessions differently. Both are shown. Merging them
// would pick a winner silently and turn a real measurement difference into
// what looks like a bug later.
//
// GA4 reports the CHANNEL a visit arrived through, never the query behind
// it, so it does not replace Search Console — nothing does.

import { makeDashboard } from "../dashboard.js";

export const mountSeo = makeDashboard({
  layoutId: "seo",
  prefix: "seo",
  title: "SEO",
  subtitle: "Storefront traffic by source. Organic search is the earned share.",
  groups: ["SEO", "Operations"],
  platform: null,
  defaultLayout: [
    "seo-sessions", "seo-organic", "seo-direct-share",
    "seo-impressions", "seo-position",
    "seo-trend", "seo-by-source",
    "seo-top-queries", "seo-top-pages",
    "seo-missed",
    "ga-organic", "ga-paid-vs-earned",
    "ga-by-channel", "ga-landing-pages",
    "seo-by-day",
    "sync-status",
  ],
});
