// Overview — every channel in one place.
//
// The only tab that adds Amazon and Shopify together. Two cautions are
// baked into how it reports:
//
//   1. Amazon reports "ordered product sales" (before refunds and before
//      Amazon's fees); Shopify reports net of refunds. They are not
//      identical measures, and the tab says so rather than implying a
//      single clean revenue number.
//   2. Blended ROAS across ad platforms is not shown. Meta and Google
//      cannot see Amazon purchases, so a combined ROAS would be fiction.
//      TACOS — total ad spend over total revenue — is shown instead,
//      because it holds regardless of who gets attribution credit.

import {
  fetchSales, fetchAds, fetchShopTotals, fetchSyncStatus,
  salesTotals, adTotals, shopTotals, byDay, denseDays, daysAvailable,
  PLATFORM_LABELS, DATA_START,
} from "../data/live.js";
import { fmtCurrency, fmtNumber, fmtPercent, fmtShortDate } from "../format.js";
import { renderDualLine, renderSpark } from "../charts.js";
import {
  escapeHtml, debounce, kpi, periodButtons, wirePeriod, periodLabel, floorNote,
  loadingBox, errorBox, emptyBox, NO_SYNC_HINT,
  syncStateFor, syncBadge, syncLine,
} from "../ui.js";

let panelEl = null;
let period = "all";
let lastRender = null;

export function mountOverview(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Overview <span id="ovBadge"></span></h2>
        <p>Every channel together — revenue, advertising, and what it costs to grow.</p>
        ${floorNote(DATA_START)}
        <div id="ovSync"></div>
      </div>
      <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
    </div>
    <div id="ovBody">${loadingBox()}</div>
  `;

  wirePeriod(el, () => period, (v) => { period = v; }, render);
  render();
  window.addEventListener("resize", debounce(() => redraw(), 150));
}

async function render() {
  const body = panelEl.querySelector("#ovBody");
  body.innerHTML = loadingBox();

  const [amz, shop, ads, runs] = await Promise.all([
    fetchSales(period),
    fetchShopTotals(period),
    fetchAds(period),
    fetchSyncStatus(),
  ]);

  const sync = syncStateFor(runs.rows, "catchr");
  panelEl.querySelector("#ovBadge").innerHTML = syncBadge(sync);
  panelEl.querySelector("#ovSync").innerHTML = syncLine(sync, "Catchr sync");

  if (amz.error && shop.error) {
    body.innerHTML = errorBox(amz.error, "Check that migrations 0004 and 0005 have been run in Supabase.");
    return;
  }
  if (!amz.rows.length && !shop.rows.length && !ads.rows.length) {
    body.innerHTML = emptyBox("No data in this window.", NO_SYNC_HINT);
    return;
  }

  const available = daysAvailable();
  const amzT = salesTotals(amz.rows);
  const shopT = shopTotals(shop.rows);
  const revenue = amzT.revenue + shopT.net;

  const byPlatform = new Map();
  for (const r of ads.rows) {
    if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, []);
    byPlatform.get(r.platform).push(r);
  }
  const spendByPlatform = [...byPlatform.entries()].map(([p, rows]) => ({
    platform: p,
    label: PLATFORM_LABELS[p] || p,
    ...adTotals(rows),
  }));
  const totalSpend = spendByPlatform.reduce((s, p) => s + p.cost, 0);
  const tacos = revenue > 0 ? totalSpend / revenue : null;

  // Daily blended revenue: Amazon ordered sales + Shopify net.
  const amzDay = byDay(amz.rows, (r) => ({ amazon: Number(r.ordered_sales) || 0 }));
  const shopDay = byDay(shop.rows, (r) => ({ shopify: Number(r.net_sales) || 0 }));
  const adDay = byDay(ads.rows, (r) => ({ spend: Number(r.cost) || 0 }));
  const merged = new Map();
  for (const [d, v] of amzDay) merged.set(d, { ...(merged.get(d) || {}), ...v });
  for (const [d, v] of shopDay) merged.set(d, { ...(merged.get(d) || {}), ...v });
  for (const [d, v] of adDay) merged.set(d, { ...(merged.get(d) || {}), ...v });
  const daily = denseDays(period, merged, ["amazon", "shopify", "spend"]).map((d) => ({
    ...d,
    revenue: d.amazon + d.shopify,
  }));

  const amzShare = revenue > 0 ? amzT.revenue / revenue : 0;

  body.innerHTML = `
    <div class="hero" id="ovHero"></div>

    <div class="channel-grid">
      ${channelCard("Amazon", fmtCurrency(amzT.revenue), `${fmtNumber(amzT.units)} units · ${fmtPercent(amzShare)} of revenue`)}
      ${channelCard("Shopify", fmtCurrency(shopT.net), `${fmtNumber(shopT.orders)} orders · ${fmtPercent(1 - amzShare)} of revenue`)}
      ${spendByPlatform.length
        ? spendByPlatform
            .map((p) => channelCard(p.label, fmtCurrency(p.cost), p.cost > 0 ? `${fmtNumber(p.clicks)} clicks · ad spend` : "no spend in window", p.cost === 0))
            .join("")
        : channelCard("Ad spend", "—", "no ad rows synced", true)}
    </div>

    <div class="kpi-grid" id="ovKpis"></div>

    <div class="insight">
      <div class="ico">i</div>
      <div class="body">
        Amazon reports <strong>ordered product sales</strong> — before refunds and before
        Amazon's referral and FBA fees. Shopify reports <strong>net of refunds</strong>.
        The combined figure mixes the two, so treat it as an upper bound.
        No blended ROAS is shown: Meta and Google can't observe Amazon purchases,
        so only <strong>TACOS</strong> is meaningful across channels.
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Revenue vs ad spend</h3>
        <span class="hint">${daily.length ? `${fmtShortDate(daily[0].label)} – ${fmtShortDate(daily[daily.length - 1].label)}` : "—"}</span>
      </div>
      <div class="card-body">
        <svg class="chart" id="ovChart"></svg>
        <div class="legend">
          <span><span class="dot ink"></span>Ad spend</span>
          <span><span class="dot accent"></span>Revenue (Amazon + Shopify)</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Daily by channel</h3><span class="hint">Most recent first</span></div>
      <div class="card-body flush">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th class="num">Amazon</th>
                <th class="num">Shopify</th>
                <th class="num">Total</th>
                <th class="num">Ad spend</th>
                <th class="num">TACOS</th>
              </tr>
            </thead>
            <tbody>
              ${[...daily].reverse().map((d) => `
                <tr>
                  <td class="muted">${fmtShortDate(d.label)}</td>
                  <td class="num">${fmtCurrency(d.amazon)}</td>
                  <td class="num">${fmtCurrency(d.shopify)}</td>
                  <td class="num"><strong>${fmtCurrency(d.revenue)}</strong></td>
                  <td class="num">${fmtCurrency(d.spend)}</td>
                  <td class="num">${d.revenue > 0 ? fmtPercent(d.spend / d.revenue) : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  panelEl.querySelector("#ovHero").innerHTML = `
    <div class="eyebrow">Total revenue · ${escapeHtml(periodLabel(period, available))}</div>
    <div class="figure">
      <div class="number">${fmtCurrency(revenue)}</div>
      <span class="delta">${fmtCurrency(totalSpend)} ad spend</span>
    </div>
    <div class="sub">${fmtCurrency(amzT.revenue)} Amazon · ${fmtCurrency(shopT.net)} Shopify${tacos == null ? "" : ` · ${fmtPercent(tacos)} TACOS`}</div>
    <div class="spark-wrap"><svg class="spark" id="ovSpark"></svg></div>
  `;

  panelEl.querySelector("#ovKpis").innerHTML = [
    kpi("TACOS", tacos == null ? "—" : fmtPercent(tacos), "ad spend ÷ total revenue"),
    kpi("Shopify orders", fmtNumber(shopT.orders), shopT.refunds > 0 ? `${fmtCurrency(shopT.refunds)} refunded` : "no refunds"),
    kpi("Amazon units", fmtNumber(amzT.units), `${fmtNumber(amzT.sessions)} sessions`),
    kpi("Revenue / day", fmtCurrency(daily.length ? revenue / daily.length : 0), `over ${daily.length} days`),
  ].join("");

  lastRender = { daily };
  redraw();
}

function channelCard(name, value, foot, off = false) {
  return `
    <div class="channel-card${off ? " is-off" : ""}">
      <span class="ch-name">${escapeHtml(name)}</span>
      <span class="ch-value">${value}</span>
      <span class="ch-foot">${escapeHtml(foot)}</span>
    </div>`;
}

function redraw() {
  if (!lastRender || !panelEl?.querySelector("#ovChart")) return;
  const { daily } = lastRender;
  if (!daily.length) return;

  renderSpark(panelEl.querySelector("#ovSpark"), daily.map((d) => d.revenue));
  renderDualLine(panelEl.querySelector("#ovChart"), daily, {
    height: 240,
    primaryKey: "spend",
    secondaryKey: "revenue",
    axisLabels: [
      fmtShortDate(daily[0].label),
      fmtShortDate(daily[Math.floor(daily.length / 2)].label),
      fmtShortDate(daily[daily.length - 1].label),
    ],
  });
}
