// Amazon Ads in full. Keywords here are the ones Amazon reports as having
// MATCHED each search term, which is why they arrive with the search-term
// rows rather than needing a report of their own.
import { makeAdsDetailTab } from "./adsdetail.js";

export const mountAmazonAds = makeAdsDetailTab({
  prefix: "aad",
  platform: "amazon-ads",
  title: "Amazon Ads",
  blurb: "Sponsored Products campaigns, matched keywords and targets, and the search terms customers typed.",
  attributionNote:
    "Sales and orders are Amazon's 14-day click attribution. Landing pages are not shown: every click goes to a product detail page Amazon owns.",
});
