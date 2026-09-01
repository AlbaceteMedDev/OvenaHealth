// Google Ads in full. The existing Google tab keeps its Merchant Center feed
// block, which is about whether Shopping can serve at all; this one is about
// where the money went.
import { makeAdsDetailTab } from "./adsdetail.js";

export const mountGoogleAds = makeAdsDetailTab({
  prefix: "gad",
  platform: "google-ads",
  title: "Google Ads",
  blurb: "Campaigns, the keywords bid on, the search terms customers typed, and the landing pages clicks arrived on.",
  attributionNote:
    "Sales and orders are Google's own conversion tag, not Amazon's 14-day click attribution. The two are never added together.",
});
