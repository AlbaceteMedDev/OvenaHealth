// One ad platform, in full: campaigns, the keywords we bid on, the search
// terms customers actually typed, and (Google only) the landing pages the
// clicks arrived on.
//
// Google and Amazon get their own tab from this same factory because their
// data genuinely differs, and the differences are the point rather than
// something to paper over:
//
//   Campaigns      both, from ads_daily, the same table the Overview totals
//                  come from — so a campaign figure here can never disagree
//                  with the one on Overview.
//   Keywords       Amazon's come free: its search-term report carries the
//                  matched keyword, match type and campaign on every row, so
//                  they are rolled up from ads_search_terms. Google's need
//                  their own report view and their own table.
//   Search terms   both, from ads_search_terms.
//   Landing pages  Google only. Amazon sends every click to a product detail
//                  page it owns, so there is no landing page to report.
//
// Attribution is never blended across platforms. Amazon reports 14-day
// click-attributed sales; Google reports whatever its own tag counts. Each
// tab shows one platform, so within a tab the figures are comparable.

import {
  fetchAds, fetchSearchTerms, fetchGoogleKeywords, fetchGoogleLandingPages,
  fetchSyncStatus, rollupAdRows, daysAvailable, DATA_START,
} from "../data/live.js";
import { fmtCurrency, fmtNumber, fmtPercent } from "../format.js";
import {
  escapeHtml, debounce, periodButtons, wirePeriod, periodLabel, floorNote,
  loadingBox, errorBox, emptyBox, NO_SYNC_HINT, syncStateFor, syncBadge, syncLine,
  kpi, acosTone,
} from "../ui.js";
import { exportButton, wireExport } from "../export.js";

export function makeAdsDetailTab(cfg) {
  const P = cfg.prefix;
  const isGoogle = cfg.platform === "google-ads";

  // Landing pages exist for Google alone; offering an always-empty section on
  // the Amazon tab would look like a broken feed rather than an absent one.
  const SECTIONS = [
    { id: "campaigns", label: "Campaigns" },
    { id: "keywords", label: "Keywords" },
    { id: "terms", label: "Search terms" },
    ...(isGoogle ? [{ id: "pages", label: "Landing pages" }] : []),
  ];

  let panelEl = null;
  let period = "all";
  let section = "campaigns";
  let q = "";
  let ctx = null;

  function mount(el) {
    panelEl = el;
    el.innerHTML = `
      <div class="tab-header">
        <div class="titles">
          <h2>${escapeHtml(cfg.title)} <span id="${P}Badge"></span></h2>
          <p>${escapeHtml(cfg.blurb)}</p>
          ${floorNote(DATA_START)}
          <div id="${P}Sync"></div>
        </div>
        <div class="tab-tools">
          <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
          ${exportButton(`${P}Export`)}
        </div>
      </div>
      <div id="${P}Body">${loadingBox()}</div>
    `;
    wirePeriod(el, () => period, (v) => { period = v; }, render);
    wireExport(el, `${P}Export`, () => ctx?.exportData);
    render();
  }

  // ---- data --------------------------------------------------------

  async function render() {
    const body = panelEl.querySelector(`#${P}Body`);
    body.innerHTML = loadingBox();

    const [ads, terms, runs, gKw, gPages] = await Promise.all([
      fetchAds(period),
      fetchSearchTerms(period),
      fetchSyncStatus(),
      isGoogle ? fetchGoogleKeywords(period) : Promise.resolve({ rows: [], error: null }),
      isGoogle ? fetchGoogleLandingPages(period) : Promise.resolve({ rows: [], error: null }),
    ]);

    const sync = syncStateFor(runs.rows, "catchr");
    panelEl.querySelector(`#${P}Badge`).innerHTML = syncBadge(sync);
    panelEl.querySelector(`#${P}Sync`).innerHTML = syncLine(sync, "Ad sync");

    const adRows = (ads.rows || []).filter((r) => r.platform === cfg.platform);
    const termRows = (terms.rows || []).filter((r) => r.platform === cfg.platform);

    if (ads.error && !adRows.length) {
      body.innerHTML = errorBox(ads.error, NO_SYNC_HINT);
      return;
    }
    if (!adRows.length && !termRows.length) {
      body.innerHTML = emptyBox(`No ${cfg.title} activity in this window.`, NO_SYNC_HINT);
      return;
    }

    ctx = {
      campaigns: rollupAdRows(
        adRows.map((r) => ({ ...r, sales: r.attributed_sales, orders: r.attributed_orders })),
        (r) => r.campaign_name || "(unnamed)",
      ),
      // Amazon's keywords come from the search-term rows, which carry the
      // matched keyword on every line. Google's come from their own report.
      keywords: isGoogle
        ? rollupAdRows(gKw.rows || [], (r) => r.keyword, ["match_type", "campaign_name", "ad_group_name"])
        : rollupAdRows(termRows.filter((r) => r.keyword), (r) => r.keyword, ["match_type", "campaign_name"]),
      terms: rollupAdRows(termRows, (r) => r.search_term, ["keyword", "match_type", "campaign_name"]),
      pages: isGoogle
        ? rollupAdRows(gPages.rows || [], (r) => r.landing_page, ["campaign_name"])
        : [],
      errors: {
        keywords: isGoogle ? gKw.error : terms.error,
        pages: isGoogle ? gPages.error : null,
        terms: terms.error,
      },
      totals: rollupAdRows(
        adRows.map((r) => ({ ...r, sales: r.attributed_sales, orders: r.attributed_orders })),
        () => "all",
      )[0] || { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
    };
    paint();
  }

  // ---- paint -------------------------------------------------------

  function paint() {
    const body = panelEl.querySelector(`#${P}Body`);
    const t = ctx.totals;

    body.innerHTML = `
      <div class="hero">
        <div class="eyebrow">${escapeHtml(cfg.title)} spend &middot; ${escapeHtml(periodLabel(period, daysAvailable()))}</div>
        <div class="figure">
          <div class="number">${fmtCurrency(t.cost)}</div>
          <span class="delta ${t.sales > 0 ? "up" : "down"}">
            ${t.sales > 0 ? `${fmtCurrency(t.sales)} attributed sales` : "no attributed sales"}
          </span>
        </div>
        <div class="sub">${escapeHtml(cfg.attributionNote)}</div>
      </div>

      <div class="kpi-grid">
        ${kpi("Campaigns", fmtNumber(ctx.campaigns.length))}
        ${kpi("Keywords", fmtNumber(ctx.keywords.length), isGoogle ? "bid keywords" : "matched keywords")}
        ${kpi("Search terms", fmtNumber(ctx.terms.length), "what customers typed")}
        ${kpi("Clicks", fmtNumber(t.clicks), t.clicks > 0 ? `${fmtCurrency(t.cost / t.clicks)} avg CPC` : "")}
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Detail</h3>
          <span class="hint" id="${P}Count"></span>
        </div>
        <div class="card-body">
          <div class="controls" style="margin-bottom:14px;">
            <input type="search" id="${P}Search" placeholder="Filter..." value="${escapeHtml(q)}" />
            <div class="segmented" role="group" aria-label="Section">
              ${SECTIONS.map((s) => `<button type="button" data-sect="${s.id}" aria-pressed="${s.id === section}">${s.label}</button>`).join("")}
            </div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead id="${P}Head"></thead>
            <tbody id="${P}Rows"></tbody>
          </table>
        </div>
      </div>
    `;

    panelEl.querySelector(`#${P}Search`).addEventListener("input", debounce((e) => {
      q = e.target.value.trim().toLowerCase();
      renderRows();
    }, 150));
    panelEl.querySelectorAll("[data-sect]").forEach((b) =>
      b.addEventListener("click", () => {
        section = b.dataset.sect;
        panelEl.querySelectorAll("[data-sect]").forEach((x) =>
          x.setAttribute("aria-pressed", x === b ? "true" : "false"));
        renderRows();
      }));

    renderRows();
  }

  // What the first column means changes with the section; everything after it
  // is the same shape, so only the label and the secondary line differ.
  const COLUMN = {
    campaigns: { label: "Campaign", sub: () => "" },
    keywords: {
      label: "Keyword",
      sub: (r) => [
        r.extra.match_type?.[0] && r.extra.match_type[0].replace(/_/g, " ").toLowerCase(),
        r.extra.campaign_name?.[0],
        r.extra.ad_group_name?.[0],
      ].filter(Boolean).join(" &middot; "),
    },
    terms: {
      label: "Search term",
      sub: (r) => (r.extra.keyword?.length
        ? `matched ${escapeHtml(r.extra.keyword.slice(0, 2).join(", "))}${r.extra.keyword.length > 2 ? ` +${r.extra.keyword.length - 2}` : ""}`
        : ""),
    },
    pages: { label: "Landing page", sub: (r) => r.extra.campaign_name?.[0] || "" },
  };

  function renderRows() {
    const rows0 = ctx[section] || [];
    const col = COLUMN[section];
    const err = ctx.errors[section];

    const rows = rows0.filter((r) => !q
      || String(r.key).toLowerCase().includes(q)
      || Object.values(r.extra || {}).flat().some((v) => String(v).toLowerCase().includes(q)));

    panelEl.querySelector(`#${P}Head`).innerHTML = `
      <tr>
        <th>${col.label}</th>
        <th class="num">Impr.</th><th class="num">Clicks</th><th class="num">Spend</th>
        <th class="num">Sales</th><th class="num">Orders</th><th class="num">ACOS</th>
      </tr>`;
    panelEl.querySelector(`#${P}Count`).textContent =
      `${fmtNumber(rows.length)} of ${fmtNumber(rows0.length)}`;

    const tbody = panelEl.querySelector(`#${P}Rows`);

    if (!rows0.length) {
      // A section with no rows is either not synced yet or genuinely empty,
      // and those need different fixes, so they are not shown as one message.
      const hint = err
        ? escapeHtml(err)
        : section === "keywords" && isGoogle
          ? "Run migration 0025, then /api/sync/google-detail. Google keywords need their own report view."
          : section === "pages"
            ? "Run migration 0025, then /api/sync/google-detail."
            : NO_SYNC_HINT;
      tbody.innerHTML = `<tr><td colspan="7">${emptyBox(`No ${col.label.toLowerCase()} rows in this window.`, hint)}</td></tr>`;
      return;
    }
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty">Nothing matches that filter.</div></td></tr>`;
      return;
    }

    const CAP = 300;
    tbody.innerHTML = rows.slice(0, CAP).map((r) => {
      const sub = col.sub(r);
      return `
        <tr${r.cost > 0 && r.sales === 0 ? ' class="row-low"' : ""}>
          <td class="ink">${escapeHtml(String(r.key))}${sub ? `<div class="muted" style="font-size:12px;">${sub}</div>` : ""}</td>
          <td class="num">${fmtNumber(r.impressions)}</td>
          <td class="num">${fmtNumber(r.clicks)}</td>
          <td class="num ink"><strong>${fmtCurrency(r.cost)}</strong></td>
          <td class="num">${r.sales > 0 ? fmtCurrency(r.sales) : '<span class="muted">&mdash;</span>'}</td>
          <td class="num">${r.orders > 0 ? fmtNumber(Math.round(r.orders)) : '<span class="muted">&mdash;</span>'}</td>
          <td class="num ${r.acos == null ? "" : acosTone(r.acos)}">${r.acos == null ? '<span class="muted">&mdash;</span>' : fmtPercent(r.acos)}</td>
        </tr>`;
    }).join("")
      + (rows.length > CAP
        ? `<tr><td colspan="7"><div class="empty">Showing the top ${fmtNumber(CAP)} of ${fmtNumber(rows.length)} by spend. Export the CSV for all of them.</div></td></tr>`
        : "");

    // Export follows the section on screen, so what downloads is what is being
    // looked at rather than a fixed sheet.
    ctx.exportData = {
      name: `${cfg.platform}-${section}`,
      rows: rows0.map((r) => ({
        [section.slice(0, -1) || "row"]: r.key,
        details: Object.values(r.extra || {}).flat().join(" | "),
        impressions: r.impressions, clicks: r.clicks,
        spend: r.cost.toFixed(2), sales: r.sales.toFixed(2), orders: r.orders,
        acos: r.acos == null ? "" : (r.acos * 100).toFixed(1) + "%",
        roas: r.roas == null ? "" : r.roas.toFixed(2),
      })),
      columns: [
        { key: section.slice(0, -1) || "row", label: col.label.toLowerCase().replace(/\s+/g, "_") },
        { key: "details", label: "details" }, { key: "impressions", label: "impressions" },
        { key: "clicks", label: "clicks" }, { key: "spend", label: "spend" },
        { key: "sales", label: "attributed_sales" }, { key: "orders", label: "attributed_orders" },
        { key: "acos", label: "acos" }, { key: "roas", label: "roas" },
      ],
    };
  }

  return mount;
}
