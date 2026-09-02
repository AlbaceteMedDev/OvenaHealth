// Keywords tab — what people actually typed before they saw an Ovena ad.
//
// Search TERMS are the customer's words. KEYWORDS are what we bid on. They
// are different things and the gap between them is where wasted spend lives,
// so the table shows both: a term costing money against a keyword that never
// intended to match it is the thing worth finding here.
//
// The two platforms are deliberately NOT merged into one blended figure.
// Amazon reports 14-day click-attributed sales; Google reports whatever its
// own conversion tag counts, which is currently zero on every term. Adding
// them would produce a ROAS that means nothing, so spend is totalled across
// both and sales are always shown per platform.

import { fetchSearchTerms, rollupSearchTerms, fetchSyncStatus, daysAvailable, DATA_START, clearCache }
  from "../data/live.js";
import { supabase } from "../supabase.js";
import { fmtCurrency, fmtNumber, fmtPercent } from "../format.js";
import {
  escapeHtml, debounce, periodButtons, wirePeriod, periodLabel, floorNote,
  loadingBox, errorBox, emptyBox, NO_SYNC_HINT, syncStateFor, syncBadge, syncLine,
  kpi, acosTone, fmtRatio,
} from "../ui.js";
import { exportButton, wireExport } from "../export.js";

const P = "kw";

const PLATFORMS = [
  { id: "all", label: "All" },
  { id: "amazon-ads", label: "Amazon" },
  { id: "google-ads", label: "Google" },
];

const SORTS = [
  { id: "cost", label: "Spend", pick: (r) => r.cost },
  { id: "sales", label: "Sales", pick: (r) => r.sales },
  { id: "clicks", label: "Clicks", pick: (r) => r.clicks },
  { id: "impressions", label: "Impressions", pick: (r) => r.impressions },
  { id: "orders", label: "Orders", pick: (r) => r.orders },
];

let panelEl = null;
let period = "all";
let platform = "all";
let sortBy = "cost";
let q = "";
let onlyWaste = false;
let ctx = null;

export function mountKeywords(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Keywords <span id="${P}Badge"></span></h2>
        <p>The search terms customers typed before an Ovena ad was shown, with what each one cost and what it sold. Google withholds low-volume terms from this report, so Google's total here runs below its campaign spend on the Google Ads tab — the gap is spend on terms Google will not name.</p>
        ${floorNote(DATA_START)}
        <div id="${P}Sync"></div>
      </div>
      <div class="tab-tools">
        <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
        ${exportButton(`${P}Export`)}
        <button type="button" class="btn ghost" id="${P}SyncNow"
                title="Pull the latest search terms from Amazon and Google now">Sync now</button>
      </div>
    </div>
    <div id="${P}Body">${loadingBox()}</div>
  `;

  wirePeriod(el, () => period, (v) => { period = v; }, render);
  wireExport(el, `${P}Export`, () => ctx?.exportData);
  wireSyncNow(el);
  render();
}

// A sync is not a refresh. Reloading re-reads the database, and between the
// six-hourly crons the database already holds the newest search terms that
// exist — so refreshing could never make this page newer. This asks the
// platforms for new data, then re-reads.
function wireSyncNow(el) {
  const btn = el.querySelector(`#${P}SyncNow`);
  if (!btn) return;

  const say = (text, warn) => {
    const line = panelEl?.querySelector(`#${P}Sync`);
    if (line) line.innerHTML = `<div class="syncline">${warn ? "\u26a0\ufe0f " : ""}${escapeHtml(text)}</div>`;
  };

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Syncing\u2026";
    say("Asking Amazon and Google for the latest search terms\u2026");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) { say("Not signed in \u2014 reload the page.", true); return; }

      const res = await fetch("/api/sync-now?job=searchterms", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        // The function keeps running after the browser gives up, so an abort
        // is reported as still running, never as failed.
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // 429 and 409 are the rate limits working: information, not failure.
        say(body?.error || `Sync failed (HTTP ${res.status}).`, res.status >= 500);
        return;
      }

      // The table is a poor receipt. The platforms report 1-3 days behind, so
      // a perfectly good sync usually rewrites identical rows and nothing
      // visibly moves. Report what the sync itself said instead.
      const r = body?.result || {};
      const per = Object.entries(r.platforms || {})
        .map(([k, v]) => `${k.replace("-ads", "")} ${fmtNumber(v.rows || 0)}`)
        .join(" \u00b7 ");
      say([
        `Synced ${fmtNumber(r.written || 0)} rows`,
        per || null,
        body.partial ? "some platforms reported errors" : null,
      ].filter(Boolean).join(" \u00b7 ") +
        ". Search-term data lags 1\u20133 days, so the newest days fill in later.");

      // Without this the 60-second read cache returns the pre-sync rows and a
      // successful sync looks like it did nothing.
      clearCache();
      await render();
    } catch (err) {
      say(
        err?.name === "TimeoutError"
          ? "Still running in the background \u2014 give it a minute, then refresh."
          : `Sync failed: ${err.message}`,
        true,
      );
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

// ---- data ----------------------------------------------------------

async function render() {
  const body = panelEl.querySelector(`#${P}Body`);
  body.innerHTML = loadingBox();

  const [terms, runs] = await Promise.all([fetchSearchTerms(period), fetchSyncStatus("searchterms")]);

  const sync = syncStateFor(runs.rows, "searchterms");
  panelEl.querySelector(`#${P}Badge`).innerHTML = syncBadge(sync);
  panelEl.querySelector(`#${P}Sync`).innerHTML = syncLine(sync, "Search-term sync");

  if (terms.error) {
    body.innerHTML = errorBox(
      terms.error,
      "Run supabase/migrations/0021_ads_search_terms.sql in the Supabase SQL editor, then let /api/sync/searchterms run.",
    );
    return;
  }
  if (!terms.rows.length) {
    body.innerHTML = emptyBox("No search terms in this window.", NO_SYNC_HINT);
    return;
  }

  const rolled = rollupSearchTerms(terms.rows);
  const byPlatform = new Map();
  for (const r of rolled) {
    const s = byPlatform.get(r.platform) || { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, terms: 0 };
    s.cost += r.cost; s.sales += r.sales; s.orders += r.orders;
    s.clicks += r.clicks; s.impressions += r.impressions; s.terms += 1;
    byPlatform.set(r.platform, s);
  }

  // Rows arrive already summed across the window, so day coverage comes from
  // the endpoint's coverage map rather than from a date column.
  const cov = terms.coverage || {};
  const firsts = Object.values(cov).map((c) => c.first).filter(Boolean).sort();
  const lasts = Object.values(cov).map((c) => c.last).filter(Boolean).sort();
  ctx = {
    rolled,
    byPlatform,
    lastDay: Object.fromEntries([...byPlatform.keys()].map((p) => [p, cov[p]?.last || null])),
    covered: firsts.length ? { first: firsts[0], last: lasts[lasts.length - 1] } : null,
    exportData: {
      name: "search-terms",
      rows: rolled.map((r) => ({
        platform: r.platform,
        search_term: r.searchTerm,
        matched_keywords: r.keywords.join(" | "),
        match_types: r.matchTypes.join(" | "),
        campaigns: r.campaigns.join(" | "),
        impressions: r.impressions,
        clicks: r.clicks,
        spend: r.cost.toFixed(2),
        attributed_sales: r.sales.toFixed(2),
        orders: r.orders,
        units: r.units,
        acos: r.acos == null ? "" : (r.acos * 100).toFixed(1) + "%",
        roas: r.roas == null ? "" : r.roas.toFixed(2),
      })),
      columns: [
        { key: "platform", label: "platform" }, { key: "search_term", label: "search_term" },
        { key: "matched_keywords", label: "matched_keywords" }, { key: "match_types", label: "match_types" },
        { key: "campaigns", label: "campaigns" }, { key: "impressions", label: "impressions" },
        { key: "clicks", label: "clicks" }, { key: "spend", label: "spend" },
        { key: "attributed_sales", label: "attributed_sales" }, { key: "orders", label: "orders" },
        { key: "units", label: "units" }, { key: "acos", label: "acos" }, { key: "roas", label: "roas" },
      ],
    },
  };

  paint();
}

// ---- paint ---------------------------------------------------------

function paint() {
  const body = panelEl.querySelector(`#${P}Body`);
  const { rolled, byPlatform } = ctx;

  const amz = byPlatform.get("amazon-ads");
  const goo = byPlatform.get("google-ads");
  const totalCost = [...byPlatform.values()].reduce((t, s) => t + s.cost, 0);
  const totalSales = [...byPlatform.values()].reduce((t, s) => t + s.sales, 0);
  const totalOrders = [...byPlatform.values()].reduce((t, s) => t + s.orders, 0);
  const totalClicks = [...byPlatform.values()].reduce((t, s) => t + s.clicks, 0);

  // Attributed sales come from each platform's own model. Blending them into
  // one ROAS would be a fabricated number, so the hero shows spend as the
  // single honest total and splits the return underneath it.
  const heroSub = [
    amz ? `Amazon ${fmtCurrency(amz.cost)} spend to ${fmtCurrency(amz.sales)} attributed sales` : null,
    goo ? `Google ${fmtCurrency(goo.cost)} spend to ${fmtCurrency(goo.sales)} attributed` : null,
  ].filter(Boolean).join(" &middot; ");

  const zeroSaleSpend = rolled.filter((r) => r.sales === 0).reduce((t, r) => t + r.cost, 0);

  body.innerHTML = `
    <div class="hero">
      <div class="eyebrow">Ad spend on search terms &middot; ${escapeHtml(periodLabel(period, daysAvailable()))}</div>
      <div class="figure">
        <div class="number">${fmtCurrency(totalCost)}</div>
        <span class="delta ${totalSales > 0 ? "up" : "down"}">
          ${fmtCurrency(totalSales)} attributed sales
        </span>
      </div>
      <div class="sub">${heroSub}</div>
    </div>

    <div class="kpi-grid">
      ${kpi("Search terms", fmtNumber(rolled.length), `${fmtNumber(byPlatform.get("amazon-ads")?.terms || 0)} Amazon &middot; ${fmtNumber(byPlatform.get("google-ads")?.terms || 0)} Google`)}
      ${kpi("Clicks", fmtNumber(totalClicks), totalClicks > 0 ? `${fmtCurrency(totalCost / totalClicks)} avg CPC` : "")}
      ${kpi("Attributed orders", fmtNumber(Math.round(totalOrders)), "platform attribution, not blended")}
      ${kpi("Spend with no sale", fmtCurrency(zeroSaleSpend),
            totalCost > 0 ? `${fmtPercent(zeroSaleSpend / totalCost)} of spend` : "", "warn")}
    </div>

    ${googleNote()}

    <div class="card">
      <div class="card-head">
        <h3>Search terms</h3>
        <span class="hint" id="${P}Count"></span>
      </div>
      <div class="card-body">
        <div class="controls" style="margin-bottom:14px;">
          <input type="search" id="${P}Search" placeholder="Search a term, keyword or campaign..." value="${escapeHtml(q)}" />
          <div class="segmented" id="${P}Plat" role="group" aria-label="Platform">
            ${PLATFORMS.map((p) => `<button type="button" data-plat="${p.id}" aria-pressed="${p.id === platform}">${p.label}</button>`).join("")}
          </div>
          <select id="${P}Sort">
            ${SORTS.map((s) => `<option value="${s.id}"${s.id === sortBy ? " selected" : ""}>Sort by ${s.label}</option>`).join("")}
          </select>
          <label class="check"><input type="checkbox" id="${P}Waste"${onlyWaste ? " checked" : ""} /> Spend, no sales</label>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Search term</th>
              <th>Platform</th>
              <th>Matched keyword</th>
              <th class="num">Impr.</th>
              <th class="num">Clicks</th>
              <th class="num">Spend</th>
              <th class="num">Sales</th>
              <th class="num">Orders</th>
              <th class="num">ACOS</th>
            </tr>
          </thead>
          <tbody id="${P}Body2"></tbody>
        </table>
      </div>
    </div>
  `;

  panelEl.querySelector(`#${P}Search`).addEventListener("input", debounce((e) => {
    q = e.target.value.trim().toLowerCase();
    renderRows();
  }, 150));
  // aria-pressed is the active state the shared .segmented style keys on, so
  // the platform toggle looks and behaves like the period one beside it.
  panelEl.querySelectorAll("[data-plat]").forEach((b) =>
    b.addEventListener("click", () => {
      platform = b.dataset.plat;
      panelEl.querySelectorAll("[data-plat]").forEach((x) =>
        x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      renderRows();
    }));
  panelEl.querySelector(`#${P}Sort`).addEventListener("change", (e) => {
    sortBy = e.target.value;
    renderRows();
  });
  panelEl.querySelector(`#${P}Waste`).addEventListener("change", (e) => {
    onlyWaste = e.target.checked;
    renderRows();
  });

  renderRows();
}

// Google's conversion column is zero on every term. That is a real finding,
// not a gap to hide: either its tag is not recording purchases or the spend
// genuinely returned nothing, and both are worth saying out loud on the page
// rather than letting an empty column imply the data is missing.
function googleNote() {
  const goo = ctx.byPlatform.get("google-ads");
  if (!goo || goo.sales > 0) return "";
  return `
    <div class="insight">
      <div class="ico">i</div>
      <div class="body">
        Google reports <strong>zero conversions on every search term</strong> against
        ${escapeHtml(fmtCurrency(goo.cost))} of spend, so no Google ROAS is shown. Either its
        conversion tag is not recording purchases or the spend genuinely returned nothing;
        the two look identical from here. Google also exposes the search term only, with no
        campaign, match type or matched keyword, which is why those columns are empty for it.
      </div>
    </div>`;
}

function renderRows() {
  const tbody = panelEl.querySelector(`#${P}Body2`);
  const pick = SORTS.find((s) => s.id === sortBy).pick;

  const rows = ctx.rolled
    .filter((r) => platform === "all" || r.platform === platform)
    .filter((r) => !onlyWaste || (r.cost > 0 && r.sales === 0))
    .filter((r) => !q
      || r.searchTerm.includes(q)
      || r.keywords.some((k) => k.toLowerCase().includes(q))
      || r.campaigns.some((c) => c.toLowerCase().includes(q)))
    .sort((a, b) => pick(b) - pick(a));

  panelEl.querySelector(`#${P}Count`).textContent =
    `${fmtNumber(rows.length)} of ${fmtNumber(ctx.rolled.length)} terms`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty">No search terms match those filters.</div></td></tr>`;
    return;
  }

  // The tail is thousands of single-impression terms. Rendering all of them
  // costs seconds of layout and tells you nothing, so the table caps and says
  // so — a silent truncation would read as "that is all there was".
  const CAP = 300;
  const shown = rows.slice(0, CAP);

  tbody.innerHTML = shown.map((r) => {
    const isAmz = r.platform === "amazon-ads";
    const kw = r.keywords.length
      ? `${escapeHtml(r.keywords.slice(0, 2).join(", "))}${r.keywords.length > 2 ? ` +${r.keywords.length - 2}` : ""}`
      : `<span class="muted">not reported</span>`;
    const matchChip = r.matchTypes.length
      ? `<span class="chip">${escapeHtml(r.matchTypes[0].replace(/_/g, " ").toLowerCase())}</span>`
      : "";
    return `
      <tr${r.cost > 0 && r.sales === 0 ? ' class="row-low"' : ""}>
        <td class="ink">${escapeHtml(r.searchTerm)}</td>
        <td><span class="chip">${isAmz ? "Amazon" : "Google"}</span></td>
        <td class="muted">${kw} ${matchChip}</td>
        <td class="num">${fmtNumber(r.impressions)}</td>
        <td class="num">${fmtNumber(r.clicks)}</td>
        <td class="num ink"><strong>${fmtCurrency(r.cost)}</strong></td>
        <td class="num">${r.sales > 0 ? fmtCurrency(r.sales) : '<span class="muted">&mdash;</span>'}</td>
        <td class="num">${r.orders > 0 ? fmtNumber(Math.round(r.orders)) : '<span class="muted">&mdash;</span>'}</td>
        <td class="num ${r.acos == null ? "" : acosTone(r.acos)}">${
          r.acos == null ? '<span class="muted">&mdash;</span>' : fmtPercent(r.acos)
        }</td>
      </tr>`;
  }).join("")
    + (rows.length > CAP
      ? `<tr><td colspan="9"><div class="empty">Showing the top ${fmtNumber(CAP)} of ${fmtNumber(rows.length)} by ${escapeHtml(SORTS.find((s) => s.id === sortBy).label.toLowerCase())}. Export the CSV for all of them.</div></td></tr>`
      : "");
}
