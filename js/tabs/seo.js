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
// One source only — Shopify's own session data, via ShopifyQL, bucketed by
// referrer_source. That is the whole of what the storefront app can see:
// direct, search, social, email, unknown. Shopify does not break "search"
// down by engine or by query, so there is no keyword or ranking data here
// and none can be added without connecting Search Console separately.

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
    "seo-trend", "seo-by-source",
    "seo-by-day",
    "sync-status",
  ],
});
