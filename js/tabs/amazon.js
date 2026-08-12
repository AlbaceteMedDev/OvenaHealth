// Amazon — storefront sales, traffic, and Amazon Ads in one place.
//
// This is the only channel where ad spend can be tied to the product it
// sold, because Amazon Ads reports an advertised SKU. That join is what
// makes per-product ACOS and TACOS real here and impossible elsewhere.

import {
  fetchSales, fetchAds, fetchAdsBySku, fetchSyncStatus,
  salesTotals, salesBySku, adTotals, adMetrics, daysAvailable, startDateFor, DATA_START,
} from "../data/live.js";
import { bucketSeries, fillDays, isPartialBucket } from "../series.js";
import { getState } from "../state.js";
import { skuMap } from "../data/inventory.js";
import { fmtCurrency, fmtNumber, fmtPercent } from "../format.js";
import { renderLine, renderSpark, renderBars, renderDualLine } from "../charts.js";
import { exportButton, wireExport } from "../export.js";
import {
  escapeHtml, debounce, kpi, periodButtons, wirePeriod, periodLabel, floorNote,
  grainButtons, wireGrain,
  loadingBox, errorBox, emptyBox, NO_SYNC_HINT,
  syncStateFor, syncBadge, syncLine, acosTone, roasTone, fmtRatio,
} from "../ui.js";

let panelEl = null;
let period = "all";
let grain = "day";
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
      <div class="tab-tools">
        <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
        <div id="amzGrain"></div>
        ${exportButton("amzExport")}
      </div>
    </div>
    <div id="amzBody">${loadingBox()}</div>
  `;

  panelEl.querySelector("#amzGrain").innerHTML = grainButtons(grain, daysAvailable());
  wirePeriod(el, () => period, (v) => { period = v; }, render);
  wireGrain(el, () => grain, (v) => { grain = v; }, render);
  wireExport(el, "amzExport", () => lastRender?.exportData);
  render();
  window.addEventListener("resize", debounce(() => redraw(), 150));
}

async function render() {
  const body = panelEl.querySelector("#amzBody");
  body.innerHTML = loadingBox();

  const [sales, ads, adsBySku, runs] = await Promise.all([
    fetchSales(period), fetchAds(period), fetchAdsBySku(period), fetchSyncStatus(),
  ]);

  const sync = syncStateFor(runs.rows, "catchr");
  panelEl.querySelector("#amzBadge").innerHTML = syncBadge(sync);
  panelEl.querySelector("#amzSync").innerHTML = syncLine(sync, "Catchr sync");

  if (sales.error) {
    body.innerHTML = errorBox(sales.error, "Check that migrations 0004–0006 have been run in Supabase.");
    return;
  }
  if (!sales.rows.length) {
    body.innerHTML = emptyBox(
      "No Amazon sales rows yet.",
      "The Amazon feed hasn't been loaded. Run <code>/api/sync/catchr?days=28&amp;secret=…</code>, or wait for the cron.",
    );
    return;
  }

  const available = daysAvailable();
  const totals = salesTotals(sales.rows);
  const amazonAdRows = ads.rows.filter((r) => r.platform === "amazon-ads");
  const adT = adTotals(amazonAdRows);
  const adM = adMetrics(adT, totals.revenue);

  // ─── Bucketed series at the active granularity ──────────────────
  // Sessions are reported per ASIN and repeated on every SKU row for that
  // listing, so they're deduped per (bucket, ASIN) rather than summed.
  const salesSeries = bucketSeries(sales.rows, grain, (r) => ({
    revenue: Number(r.ordered_sales) || 0,
    units: r.units_ordered || 0,
    refunds: r.units_refunded || 0,
  }));
  const trafficSeries = bucketSeries(
    sales.rows, grain,
    (r) => ({ sessions: r.sessions || 0, pageViews: r.page_views || 0 }),
    { dedupe: (r) => r.asin || r.amazon_sku },
  );
  const adSeries = bucketSeries(amazonAdRows, grain, (r) => ({
    spend: Number(r.cost) || 0,
    attributed: Number(r.attributed_sales) || 0,
    clicks: Number(r.clicks) || 0,
  }));

  // Merge into one row per bucket so the chart and the CSV agree exactly.
  const merged = new Map();
  const put = (arr, keys) => {
    for (const b of arr) {
      const slot = merged.get(b.key) || { key: b.key, label: b.label };
      for (const k of keys) slot[k] = b[k] || 0;
      merged.set(b.key, slot);
    }
  };
  put(salesSeries, ["revenue", "units", "refunds"]);
  put(trafficSeries, ["sessions", "pageViews"]);
  put(adSeries, ["spend", "attributed", "clicks"]);

  let series = [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (grain === "day") {
    series = fillDays(series, startDateFor(period), new Date().toISOString().slice(0, 10),
      ["revenue", "units", "refunds", "sessions", "pageViews", "spend", "attributed", "clicks"]);
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const b of series) {
    b.partial = isPartialBucket(b.key, grain, DATA_START, todayIso);
    b.tipLabel = b.partial ? `${b.label} (partial)` : b.label;
    b.cvr = b.sessions > 0 ? b.units / b.sessions : 0;
    b.tacos = b.revenue > 0 ? b.spend / b.revenue : null;
    b.acos = b.attributed > 0 ? b.spend / b.attributed : null;
  }

  // ─── Per-SKU join ────────────────────────────────────────────────
  const adBySku = new Map();
  for (const r of adsBySku.rows) {
    const key = r.sku || r.amazon_sku;
    const s = adBySku.get(key) || { cost: 0, sales: 0, clicks: 0 };
    s.cost += Number(r.cost) || 0;
    s.sales += Number(r.attributed_sales) || 0;
    s.clicks += Number(r.clicks) || 0;
    adBySku.set(key, s);
  }

  const inventory = getState().inventory;
  const skus = salesBySku(sales.rows).map((s) => {
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
  }).sort((a, b) => b.revenue - a.revenue);

  const missingCogs = skus.filter((s) => !s.hasCogs).length;
  const campaigns = collapseCampaigns(amazonAdRows);
  const cvr = totals.sessions > 0 ? totals.units / totals.sessions : 0;

  body.innerHTML = `
    <div class="hero" id="amzHero"></div>
    <div class="kpi-grid" id="amzKpis"></div>

    ${adM.acos != null && adM.acos > 1 ? `
      <div class="insight"><div class="ico">!</div><div class="body">
        <strong>Sponsored Ads spent ${fmtCurrency(adT.cost)} to attribute ${fmtCurrency(adT.sales)}</strong>
        — ${fmtPercent(adM.acos)} ACOS, ${fmtRatio(adM.roas)} ROAS.
      </div></div>` : ""}

    <div class="row-2">
      <div class="card">
        <div class="card-head"><h3>Sales vs ad spend</h3><span class="hint">Hover to inspect any ${grain}</span></div>
        <div class="card-body">
          <svg class="chart" id="amzChart"></svg>
          <div class="legend"><span><span class="dot ink"></span>Ad spend</span><span><span class="dot accent"></span>Ordered sales</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Sessions</h3><span class="hint">${fmtNumber(totals.sessions)} total</span></div>
        <div class="card-body"><svg class="chart" id="amzSessChart"></svg></div>
      </div>
    </div>

    ${missingCogs ? `
      <div class="insight"><div class="ico">i</div><div class="body">
        <strong>${missingCogs} of ${skus.length} selling SKUs have no COGS.</strong>
        Contribution treats their cost as $0, and Amazon's referral and FBA fees aren't deducted — it's a ceiling.
      </div></div>` : ""}

    <div class="card">
      <div class="card-head"><h3>By ${grain}</h3><span class="hint">${series.length} buckets · most recent first</span></div>
      <div class="card-body flush"><div class="table-wrap"><table>
        <thead><tr><th>${grain === "day" ? "Date" : grain[0].toUpperCase() + grain.slice(1)}</th>
          <th class="num">Revenue</th><th class="num">Units</th><th class="num">Sessions</th>
          <th class="num">CVR</th><th class="num">Ad spend</th><th class="num">TACOS</th></tr></thead>
        <tbody>
          ${[...series].reverse().map((b) => `
            <tr>
              <td class="muted">${escapeHtml(b.label)}${b.partial ? ' <span class="chip">partial</span>' : ""}</td>
              <td class="num"><strong>${fmtCurrency(b.revenue)}</strong></td>
              <td class="num">${fmtNumber(b.units)}</td>
              <td class="num">${fmtNumber(b.sessions)}</td>
              <td class="num">${b.sessions > 0 ? fmtPercent(b.cvr) : "—"}</td>
              <td class="num">${fmtCurrency(b.spend)}</td>
              <td class="num ${b.tacos > 1 ? "val-bad" : ""}">${b.tacos == null ? "—" : fmtPercent(b.tacos)}</td>
            </tr>`).join("")}
        </tbody></table></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Products</h3><span class="hint">Sales &amp; Traffic joined with Sponsored Ads</span></div>
      <div class="card-body flush"><div class="table-wrap"><table>
        <thead><tr><th>SKU</th><th>Product</th><th class="num">Revenue</th><th class="num">Units</th>
          <th class="num">Sessions</th><th class="num">CVR</th><th class="num">Ad spend</th>
          <th class="num">ACOS</th><th class="num">TACOS</th><th class="num">Contribution</th></tr></thead>
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
        </tbody></table></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Sponsored Ads campaigns</h3><span class="hint">14-day attributed sales</span></div>
      <div class="card-body flush"><div class="table-wrap"><table>
        <thead><tr><th>Campaign</th><th class="num">Spend</th><th class="num">Impr.</th><th class="num">Clicks</th>
          <th class="num">CTR</th><th class="num">CPC</th><th class="num">Attributed</th><th class="num">ACOS</th><th class="num">ROAS</th></tr></thead>
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
        </tbody></table></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Not selling</h3><span class="hint">Stocked SKUs with no orders</span></div>
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
    kpi("Avg order value", fmtCurrency(totals.orderItems > 0 ? totals.revenue / totals.orderItems : 0), `${fmtNumber(totals.orderItems)} order items`),
    kpi("Refund rate", fmtPercent(totals.units > 0 ? totals.refunds / totals.units : 0), `${fmtNumber(totals.refunds)} units`),
  ].join("");

  lastRender = {
    series, skus,
    exportData: {
      name: "amazon",
      grain,
      rows: series.map((b) => ({
        bucket: b.label, key: b.key, partial: b.partial ? "yes" : "",
        revenue: b.revenue.toFixed(2), units: b.units, refunded_units: b.refunds,
        sessions: b.sessions, page_views: b.pageViews,
        conversion_rate: b.sessions > 0 ? (b.cvr * 100).toFixed(2) + "%" : "",
        ad_spend: b.spend.toFixed(2), attributed_sales: b.attributed.toFixed(2), ad_clicks: b.clicks,
        acos: b.acos == null ? "" : (b.acos * 100).toFixed(1) + "%",
        tacos: b.tacos == null ? "" : (b.tacos * 100).toFixed(1) + "%",
      })),
      columns: [
        { key: "bucket", label: grain }, { key: "key", label: "key" }, { key: "partial", label: "partial_bucket" },
        { key: "revenue", label: "revenue" }, { key: "units", label: "units" },
        { key: "refunded_units", label: "refunded_units" }, { key: "sessions", label: "sessions" },
        { key: "page_views", label: "page_views" }, { key: "conversion_rate", label: "conversion_rate" },
        { key: "ad_spend", label: "ad_spend" }, { key: "attributed_sales", label: "attributed_sales" },
        { key: "ad_clicks", label: "ad_clicks" }, { key: "acos", label: "acos" }, { key: "tacos", label: "tacos" },
      ],
    },
  };
  redraw();
}

function collapseCampaigns(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.campaign_id || r.campaign_name || "(unnamed)";
    const s = map.get(key) || { name: r.campaign_name || key, impressions: 0, clicks: 0, cost: 0, sales: 0 };
    s.impressions += Number(r.impressions) || 0;
    s.clicks += Number(r.clicks) || 0;
    s.cost += Number(r.cost) || 0;
    s.sales += Number(r.attributed_sales) || 0;
    map.set(key, s);
  }
  return [...map.values()].map((c) => ({
    ...c,
    ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
    cpc: c.clicks > 0 ? c.cost / c.clicks : 0,
    acos: c.sales > 0 ? c.cost / c.sales : null,
    roas: c.cost > 0 ? c.sales / c.cost : null,
  })).sort((a, b) => b.cost - a.cost);
}

function renderIdle(sold) {
  const soldSet = new Set(sold.map((r) => r.sku));
  const idle = [...skuMap.values()].filter((r) => r.listed && r.stocked && !soldSet.has(r.sku));
  if (!idle.length) return `<div class="statebox"><strong>Every stocked SKU sold in this window.</strong></div>`;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${idle.map((r) => `<span class="chip">${escapeHtml(r.sku)}</span>`).join("")}
    </div>
    <p class="muted" style="font-size:12px;margin-top:12px;">
      Zero orders in this window. The collagen line has live listings and traffic but no sales yet.
    </p>`;
}

function redraw() {
  if (!lastRender || !panelEl?.querySelector("#amzChart")) return;
  const { series, skus } = lastRender;
  if (!series.length) return;

  const labels = [series[0].label, series[Math.floor(series.length / 2)].label, series[series.length - 1].label];

  renderSpark(panelEl.querySelector("#amzSpark"), series.map((b) => b.revenue));

  renderDualLine(panelEl.querySelector("#amzChart"), series, {
    height: 220, primaryKey: "spend", secondaryKey: "revenue", axisLabels: labels,
    scrub: {
      primaryName: "Ad spend", secondaryName: "Revenue", fmt: (v) => fmtCurrency(v),
      extra: (s) => [
        { name: "Units", value: fmtNumber(s.units) },
        { name: "TACOS", value: s.tacos == null ? "—" : fmtPercent(s.tacos), cls: s.tacos > 1 ? "val-bad" : "" },
      ],
    },
  });

  renderLine(panelEl.querySelector("#amzSessChart"),
    series.map((b) => ({ label: b.label, value: b.sessions })), {
      height: 220, accent: false, axisLabels: labels,
      scrub: { name: "Sessions", fmt: (v) => fmtNumber(v) },
    });
}
