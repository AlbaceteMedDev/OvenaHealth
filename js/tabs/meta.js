// Meta Ads.
//
// Two ad accounts are connected to Catchr and both have returned zero rows
// across every window tested, so the empty state here is a statement of
// fact rather than a "something went wrong" placeholder.

import { makeAdChannelTab } from "./adchannel.js";

export const mountMeta = makeAdChannelTab({
  platform: "facebook-ads",
  title: "Meta Ads",
  blurb: "Facebook and Instagram spend, reach and conversions.",
  notConnected: `
    <div class="statebox">
      <strong>No Meta ad spend in this window.</strong>
      <span class="hint2">
        Both ad accounts are connected to Catchr and returning zero rows — there is
        no active campaign to report. This tab fills in on the next sync once one runs.
      </span>
    </div>`,
});
