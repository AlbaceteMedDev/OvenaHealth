// Overview — the only dashboard scoped to every group.
//
// Two cautions hold here and are stated on the page rather than left
// implicit: Amazon reports ordered product sales (before refunds and before
// its fees) while Shopify reports net of refunds, so the combined figure is
// an upper bound; and no blended ROAS is shown, because Meta and Google
// cannot observe Amazon purchases.

import { makeDashboard } from "../dashboard.js";

export const mountOverview = makeDashboard({
  layoutId: "overview",
  prefix: "ov",
  title: "Overview",
  subtitle: "Every channel together — revenue, advertising, and what it costs to grow.",
  groups: ["Headline", "Amazon", "Shopify", "Advertising", "SEO", "Inventory", "Margins", "Operations"],
  platform: null,
  defaultLayout: [
    "total-revenue", "contribution", "net-profit", "ad-tacos",
    "pl-breakdown", "revenue-vs-spend", "amz-sales-log", "ad-attribution",
    "amz-top-skus", "shop-top-products", "inv-low-stock", "sync-status",
  ],
});
