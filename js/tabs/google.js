// Google Ads, plus Merchant Center feed health.
//
// The feed block is not decoration. As of 2026-08-12 the Merchant Center
// account is suspended for Misrepresentation and all 13 products read
// NOT_ELIGIBLE_OR_DISAPPROVED, which means Shopping cannot serve at all —
// while Search campaigns keep spending. Showing spend without showing that
// would be a misleading dashboard, so the feed status renders first.

import { makeAdChannelTab } from "./adchannel.js";
import { fetchGmcStatus } from "../data/live.js";
import { escapeHtml } from "../ui.js";
import { fmtNumber } from "../format.js";

async function merchantCenterBlock() {
  const res = await fetchGmcStatus();
  if (res.error) return "";

  const issues = res.issues || [];
  const products = res.products || [];
  if (!issues.length && !products.length) return "";

  const serving = products.filter(
    (p) => p.destination_status && !/DISAPPROV|NOT_ELIGIBLE/i.test(p.destination_status),
  ).length;
  const blocked = products.length - serving;
  const critical = issues.filter((i) => /critical/i.test(i.severity || ""));

  const banner = critical.length
    ? `
      <div class="alertbox">
        <div class="ico">!</div>
        <div class="body">
          <strong>Merchant Center is suspended — Shopping ads cannot serve.</strong><br />
          ${critical.map((i) => escapeHtml(i.title)).join("<br />")}
          ${blocked ? `<br />${fmtNumber(blocked)} of ${fmtNumber(products.length)} products are disapproved or ineligible.` : ""}
          ${critical[0]?.documentation ? `<br /><a href="${escapeHtml(critical[0].documentation)}" target="_blank" rel="noopener noreferrer">Google's guidance on this policy →</a>` : ""}
          <br />Search campaigns below keep spending regardless. Nothing in Shopping will run until this clears.
        </div>
      </div>`
    : "";

  const rows = products.length
    ? `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-head">
          <h3>Merchant Center feed</h3>
          <span class="hint">${fmtNumber(serving)} serving · ${fmtNumber(blocked)} blocked</span>
        </div>
        <div class="card-body flush">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Status</th><th>Availability</th></tr></thead>
              <tbody>
                ${products.map((p) => {
                  const bad = /DISAPPROV|NOT_ELIGIBLE/i.test(p.destination_status || "");
                  return `
                    <tr>
                      <td class="ink">${escapeHtml(p.product_title)}</td>
                      <td class="${bad ? "val-bad" : "val-good"}">${escapeHtml(p.destination_status || "—")}</td>
                      <td class="muted">${escapeHtml(p.availability || "—")}</td>
                    </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>`
    : "";

  return banner + rows;
}

export const mountGoogle = makeAdChannelTab({
  platform: "google-ads",
  title: "Google Ads",
  blurb: "Search and Shopping spend, plus Merchant Center feed health.",
  extraBlocks: merchantCenterBlock,
  notConnected: `
    <div class="statebox">
      <strong>No Google Ads spend in this window.</strong>
      <span class="hint2">
        Google Ads is connected to Catchr (account 3661776495). If this stays empty after a
        sync, check the campaigns are enabled and that the window covers a day they ran.
      </span>
    </div>`,
});
