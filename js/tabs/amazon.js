// Amazon — storefront sales, traffic, and Amazon Ads in one place.
//
// This is the only channel where ad spend can be tied to the product it
// sold, because Amazon Ads reports an advertised SKU. That join is what
// makes per-product ACOS and TACOS real here and impossible elsewhere.

import {
  fetchSales, fetchAds, fetchAdsBySku, fetchSyncStatus,
  salesTotals, salesBySku, adTotals, adMetrics, byDay, denseDays, daysAvailable, DATA_START,
} from "../data/live.js";
import { getState } from "../state.js";
import { skuMap } from "../data/inventory.js";
import { fmtCurrency, fmtNumber, fmtPercent, fmtShortDate } from "../format.js";
import { renderLine, renderSpark, renderBars, renderDualLine } from "../charts.js";
import {
  escapeHtml, debounce, kpi, periodButtons, wirePeriod, periodLabel, floorNote,
  loadingBox, errorBox, emptyBox, NO_SYNC_HINT,
  syncStateFor, syncBadge, syncLine, acosTone, roasTone, fmtRatio,
} from "../ui.js";

let panelEl = null;
let period = "all";
let lastRender = null;

export function mountAmazon(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Amazon <span id="amzBadge"></span></h2>
        <p>Amazon.com sales, traffic, conversion and Sponsored Ads.</p>
        ${floorNote(DATA_START)}
        <div id="amzSync"></div>
      </div>
      <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
    </div>
    <div id="amzBody">${loadingBox()}</div>
  `;

  wirePeriod(el, () => period, (v) => { period = v; }, render);
  render();
  window.addEventListener("resize", debounce(() => redraw(), 150));
}

async function render() {
  const body = panelEl.querySelector("#amzBody");
  body.innerHTML = loadingBox();

  const [sales, ads, adsBySku, runs] = await Promise.all([
    fetchSales(period),
    fetchAds(period),
    fetchAdsBySku(period),
    fetchSyncStatus(),
  ]);

  const sync = syncStateFor(runs.rows, "catchr");
  panelEl.querySelector("#amzBadge").innerHTML = syncBadge(sync);
  panelEl.querySelector("#amzSync").innerHTML = syncLine(sync, "Catchr sync");

  if (sales.error) {
    body.innerHTML = errorBox(sales.error, "Check that migration 0004 has been run in Supabase.");
    return;
  }
  if (!sales.rows.length) {
    body.innerHTML = emptyBox("No Amazon sales in this window.", NO_SYNC_HINT);
    return;
  }

  const available = daysAvailable();
  const totals = salesTotals(sales.rows);
  const amazonAdRows = ads.rows.filter((r) => r.platform === "amazon-ads");
  const adT = adTotals(amazonAdRows);
  const adM = adMetrics(adT, totals.revenue);

  const cvr = totals.sessions > 0 ? totals.units / totals.sessions : 0;
  const aov = totals.orderItems > 0 ? totals.revenue / totals.orderItems : 0;
  const refundRate = totals.units > 0 ? totals.refunds / totals.units : 0;

  // Ad spend per catalog SKU, joined onto sales below.
  const adBySku = new Map();
  for (const r of adsBySku.rows) {
    const key = r.sku || r.amazon_sku;
    const slot = adBySku.get(key) || { cost: 0, sales: 0, clicks: 0 };
    slot.cost += Number(r.cost) || 0;
    slot.sales += Number(r.attributed_sales) || 0;
    slot.clicks += Number(r.clicks) || 0;
    adBySku.set(key, slot);
  }

  const inventory = getState().inventory;
  const skus = salesBySku(sales.rows)
    .map((s) => {
      const ad = adBySku.get(s.sku) || { cost: 0, sales: 0, clicks: 0 };
      const cogs = Number(inventory[s.sku]?.cogs ?? 0);
      return {
        ...s,
        adCost: ad.cost,
        adSales: ad.sales,
        acos: ad.sales > 0 ? ad.cost / ad.sales : null,
        tacos: s.revenue > 0 ? ad.cost / s.revenue : null,
        contribution: s.revenue - cogs * s.units - ad.cost,
        hasCogs: cogs > 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const missingCogs = skus.filter((s) => !s.hasCogs).length;

  const salesDay = byDay(sales.rows, (r) => ({ revenue: Number(r.ordered_sales) || 0, units: r.units_ordered || 0 }));
  const adDay = byDay(amazonAdRows, (r) => ({ spend: Number(r.cost) || 0, attributed: Number(r.attributed_sales) || 0 }));
  const merged = new Map();
  for (const [d, v] of salesDay) merged.set(d, { ...(merged.get(d) || {}), ...v });
  for (const [d, v] of adDay) merged.set(d, { ...(merged.get(d) || {}), ...v });
  const daily = denseDays(period, merged, ["revenue", "units", "spend", "attributed"]);

  // Sessions are per-ASIN in Amazon's report; dedupe before summing per day.
  const seen = new Set();
  const sessDay = new Map();
  for (const r of sales.rows) {
    const key = `${r.date}|${r.asin || r.amazon_sku}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sessDay.set(r.date, (sessDay.get(r.date) || 0) + (r.sessions || 0));
  }

  const campaigns = collapseCampaigns(amazonAdRows);

  body.innerHTML = `
    <div class="hero" id="amzHero"></div>
    <div class="kpi-grid" id="amzKpis"></div>

    ${adM.acos != null && adM.acos > 1 ? `
      <div class="insight">
        <div class="ico">!</div>
        <div class="body">
          <strong>Sponsored Ads spent ${fmtCurrency(adT.cost)} to attribute ${fmtCurrency(adT.sales)}</strong>
          — ${fmtPercent(adM.acos)} ACOS, ${fmtRatio(adM.roas)} ROAS. Each attributed sale costs
          more than it returns before product cost is counted.
        </div>
      </div>` : ""}

    <div class="row-2">
      <div class="card">
        <div class="card-head">
          <h3>Sales vs ad spend</h3>
          <span class="hint">${daily.length ? `${fmtShortDate(daily[0].label)} – ${fmtShortDate(daily[daily.length - 1].label)}` : "—"}</span>
        </div>
        <div class="card-body">
          <svg class="chart" id="amzChart"></svg>
          <div class="legend">
            <span><span class="dot ink"></span>Ad spend</span>
            <span><span class="dot accent"></span>Ordered sales</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Sessions</h3><span class="hint">${fmtNumber(totals.sessions)} in window</span></div>
        <div class="card-body"><svg class="chart" id="amzSessChart"></svg></div>
      </div>
    </div>

    ${missingCogs ? `
      <div class="insight">
        <div class="ico">i</div>
        <div class="body">
          <strong>${missingCogs} of ${skus.length} selling SKUs have no COGS entered.</strong>
          Contribution treats their unit cost as $0. Amazon's referral and FBA fees
          aren't deducted either — this is a ceiling, not profit.
        </div>
      </div>` : ""}

    <div class="card">
      <div class="card-head"><h3>Products</h3><span class="hint">Sales &amp; Traffic joined with Sponsored Ads</span></div>
      <div class="card-body flush">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th class="num">Revenue</th>
                <th class="num">Units</th>
                <th class="num">Sessions</th>
                <th class="num">CVR</th>
                <th class="num">Ad spend</th>
                <th class="num">ACOS</th>
                <th class="num">TACOS</th>
                <th class="num">Contribution</th>
              </tr>
            </thead>
            <tbody>
              ${skus.map((r) => `
                <tr>
                  <td><span class="sku-cell">${escapeHtml(r.sku)}</span></td>
                  <td class="ink">${escapeHtml(r.product)}${r.variant ? ` <span class="muted">· ${escapeHtml(r.variant)}</span>` : ""}</td>
                  <td class="num"><strong>${fmtCurrency(r.revenue)}</strong></td>
                  <td class="num">${fmtNumber(r.units)}</td>
                  <td class="num">${fmtNumber(r.sessions)}</td>
                  <td class="num">${r.sessions > 0 ? fmtPercent(r.cvr) : "—"}</td>
                  <td class="num">${fmtCurrency(r.adCost)}</td>
                  <td class="num ${acosTone(r.acos)}">${r.acos == null ? "—" : fmtPercent(r.acos)}</td>
                  <td class="num">${r.tacos == null ? "—" : fmtPercent(r.tacos)}</td>
                  <td class="num">${fmtCurrency(r.contribution)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Sponsored Ads campaigns</h3><span class="hint">14-day attributed sales, on Amazon</span></div>
      <div class="card-body flush">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th class="num">Spend</th>
                <th class="num">Impr.</th>
                <th class="num">Clicks</th>
                <th class="num">CTR</th>
                <th class="num">CPC</th>
                <th class="num">Attributed</th>
                <th class="num">ACOS</th>
                <th class="num">ROAS</th>
              </tr>
            </thead>
            <tbody>
              ${campaigns.length ? campaigns.map((c) => `
                <tr>
                  <td class="ink">${escapeHtml(c.name)}</td>
                  <td class="num"><strong>${fmtCurrency(c.cost)}</strong></td>
                  <td class="num">${fmtNumber(c.impressions)}</td>
                  <td class="num">${fmtNumber(c.clicks)}</td>
                  <td class="num">${fmtPercent(c.ctr)}</td>
                  <td class="num">${fmtCurrency(c.cpc)}</td>
                  <td class="num">${fmtCurrency(c.sales)}</td>
                  <td class="num ${acosTone(c.acos)}">${c.acos == null ? "—" : fmtPercent(c.acos)}</td>
                  <td class="num ${roasTone(c.roas)}">${fmtRatio(c.roas)}</td>
                </tr>`).join("") : `<tr><td colspan="9"><div class="empty">No ad spend in this window.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Not selling</h3><span class="hint">Listed SKUs with no orders</span></div>
      <div class="card-body">${renderIdle(skus)}</div>
    </div>
  `;

  panelEl.querySelector("#amzHero").innerHTML = `
    <div class="eyebrow">Ordered product sales · ${escapeHtml(periodLabel(period, available))}</div>
    <div class="figure">
      <div class="number">${fmtCurrency(totals.revenue)}</div>
      <span class="delta">${fmtNumber(totals.units)} units</span>
    </div>
    <div class="sub">${fmtNumber(totals.sessions)} sessions · ${fmtPercent(cvr)} conversion · ${fmtCurrency(adT.cost)} ad spend</div>
    <div class="spark-wrap"><svg class="spark" id="amzSpark"></svg></div>
  `;

  panelEl.querySelector("#amzKpis").innerHTML = [
    kpi("ACOS", adM.acos == null ? "—" : fmtPercent(adM.acos), `${fmtRatio(adM.roas)} ROAS`, acosTone(adM.acos)),
    kpi("TACOS", adM.tacos == null ? "—" : fmtPercent(adM.tacos), "ad spend ÷ Amazon revenue"),
    kpi("Avg order value", fmtCurrency(aov), `${fmtNumber(totals.orderItems)} order items`),
    kpi("Refund rate", fmtPercent(refundRate), `${fmtNumber(totals.refunds)} units refunded`),
  ].join("");

  lastRender = {
    daily,
    sessions: daily.map((d) => ({ label: d.label, value: sessDay.get(d.label) || 0 })),
    skus,
  };
  redraw();
}

function collapseCampaigns(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.campaign_id || r.campaign_name || "(unnamed)";
    const slot = map.get(key) || { name: r.campaign_name || key, impressions: 0, clicks: 0, cost: 0, sales: 0 };
    slot.impressions += Number(r.impressions) || 0;
    slot.clicks += Number(r.clicks) || 0;
    slot.cost += Number(r.cost) || 0;
    slot.sales += Number(r.attributed_sales) || 0;
    map.set(key, slot);
  }
  return [...map.values()]
    .map((c) => ({
      ...c,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
      cpc: c.clicks > 0 ? c.cost / c.clicks : 0,
      acos: c.sales > 0 ? c.cost / c.sales : null,
      roas: c.cost > 0 ? c.sales / c.cost : null,
    }))
    .sort((a, b) => b.cost - a.cost);
}

function renderIdle(sold) {
  const soldSet = new Set(sold.map((r) => r.sku));
  const idle = [...skuMap.values()].filter((r) => r.listed && !soldSet.has(r.sku));
  if (!idle.length) return `<div class="statebox"><strong>Every listed SKU sold in this window.</strong></div>`;
  return `
    <div style="display:flex; flex-wrap:wrap; gap:8px;">
      ${idle.map((r) => `<span class="chip">${escapeHtml(r.sku)}</span>`).join("")}
    </div>
    <p class="muted" style="font-size:12px; margin-top:12px;">
      Zero orders in this window. Confirm the listing is live and in stock before advertising it.
    </p>`;
}

function redraw() {
  if (!lastRender || !panelEl?.querySelector("#amzChart")) return;
  const { daily, sessions } = lastRender;
  if (!daily.length) return;

  renderSpark(panelEl.querySelector("#amzSpark"), daily.map((d) => d.revenue));
  renderDualLine(panelEl.querySelector("#amzChart"), daily, {
    height: 220,
    primaryKey: "spend",
    secondaryKey: "revenue",
    axisLabels: [
      fmtShortDate(daily[0].label),
      fmtShortDate(daily[Math.floor(daily.length / 2)].label),
      fmtShortDate(daily[daily.length - 1].label),
    ],
  });
  renderLine(panelEl.querySelector("#amzSessChart"), sessions, {
    height: 220,
    accent: false,
    axisLabels: [
      fmtShortDate(sessions[0].label),
      fmtShortDate(sessions[Math.floor(sessions.length / 2)].label),
      fmtShortDate(sessions[sessions.length - 1].label),
    ],
  });
}
