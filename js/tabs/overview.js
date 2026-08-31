// Overview — the only dashboard scoped to every group.
//
// Two cautions hold here and are stated on the page rather than left
// implicit: Amazon reports ordered product sales (before refunds and before
// its fees) while Shopify reports net of refunds, so the combined figure is
// an upper bound; and no blended ROAS is shown, because Meta and Google
// cannot observe Amazon purchases.
//
// Shopify's half is product revenue PLUS the postage the customer paid, as
// of 2026-08-31. It counted product alone while the P&L below charged
// outbound shipping as a cost, so the storefront was billed for postage it
// had in fact been paid for. Sales tax is recorded but is not in any total:
// it is collected for the state, not earned.

import { makeDashboard } from "../dashboard.js";

export const mountOverview = makeDashboard({
  layoutId: "overview",
  prefix: "ov",
  title: "Overview",
  subtitle: "Every channel together — revenue, advertising, and what it costs to grow. Sync now pulls live orders.",
  groups: ["Headline", "Amazon", "Shopify", "Advertising", "SEO", "Inventory", "Margins", "Operations"],
  platform: null,
  // Shopify first: it is the only live source here, so it is what makes the
  // page newer rather than merely re-fetched. Amazon and advertising follow
  // because Overview claims to be every channel together, and a total that
  // refreshed one channel and not the others would be worse than a stale one.
  syncJobs: ["shopify", "orders", "catchr"],
  defaultLayout: [
    "total-revenue", "contribution", "net-profit", "ad-tacos",
    "pl-breakdown", "revenue-vs-spend", "amz-sales-log", "ad-attribution",
    "amz-top-skus", "shop-top-products", "inv-low-stock", "sync-status",
  ],
});
