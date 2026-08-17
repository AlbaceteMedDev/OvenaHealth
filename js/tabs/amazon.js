// Amazon — scoped to Amazon's own data plus Sponsored Ads.
//
// platform is pinned to amazon-ads, so every advertising figure here
// describes Sponsored Ads alone. Meta and Google spend cannot leak in
// however the account is configured — that separation is the whole point of
// a scoped dashboard.
//
// The default layout reproduces the fixed page this replaced: hero metrics,
// sales against ad spend, sessions, the day table, the per-product ad join
// and the not-selling list. Nothing that page showed is missing; it is all
// now removable and resizable.

import { makeDashboard } from "../dashboard.js";

export const mountAmazon = makeDashboard({
  layoutId: "amazon",
  prefix: "amz",
  title: "Amazon",
  subtitle: "Amazon.com sales, traffic, conversion and Sponsored Ads.",
  groups: ["Amazon", "Advertising", "Operations"],
  platform: "amazon-ads",
  defaultLayout: [
    "amz-revenue", "amz-units", "amz-sessions", "amz-cvr",
    "ad-spend", "ad-acos", "ad-tacos", "amz-aov",
    "amz-sales-vs-spend",
    "amz-sessions-chart", "amz-not-selling",
    "amz-by-day",
    "amz-product-ads",
    "ad-attribution",
    "amz-sales-log",
    "sync-status",
  ],
});
