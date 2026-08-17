// Shopify — storefront only, reported net of refunds.
//
// No advertising platform is pinned: the storefront's paid attribution
// lives with Meta and Google, not here, and showing account-wide ad metrics
// on a storefront tab would invite exactly the wrong comparison.

import { makeDashboard } from "../dashboard.js";

export const mountShopify = makeDashboard({
  layoutId: "shopify",
  prefix: "shp",
  title: "Shopify",
  subtitle: "Storefront orders, net of refunds.",
  groups: ["Shopify", "SEO", "Operations"],
  platform: null,
  defaultLayout: [
    "shop-net", "shop-orders", "shop-refunds", "seo-organic",
    "shop-by-product-chart", "shop-top-products",
    "seo-trend", "seo-by-source",
    "shop-by-day",
    "sync-status",
  ],
});
