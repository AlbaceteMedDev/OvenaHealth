// Shared renderer for the off-Amazon ad channel tabs (Meta, Google).
//
// Both platforms have the same shape and the same fundamental limitation:
// they report conversions from their own tracking, which sees the Shopify
// storefront but is blind to Amazon. So neither tab claims a ROAS against
// total revenue — they report platform-attributed conversions, spend, and
// what share of storefront revenue that spend represents.

import {
  fetchAds, fetchShopTotals, fetchSyncStatus,
  adTotals, adMetrics, shopTotals, daysAvailable, DATA_START,
} from "../data/live.js";
import { bucketSeries, isPartialBucket } from "../series.js";
import { exportButton, wireExport } from "../export.js";
import { fmtCurrency, fmtNumber, fmtPercent, fmtShortDate } from "../format.js";
import { renderDualLine, renderSpark } from "../charts.js";
import {
  escapeHtml, debounce, kpi, periodButtons, wirePeriod, periodLabel, floorNote,
  grainButtons, wireGrain,
  loadingBox, errorBox, syncStateFor, syncBadge, syncLine, acosTone, roasTone, fmtRatio,
} from "../ui.js";

// Creates a mount function for one platform.
let wiredResize = false;

export function makeAdChannelTab({ platform, title, blurb, notConnected, extraBlocks = null }) {
  let panelEl = null;
  let period = "all";
  let grain = "day";
  let lastRender = null;

  async function render() {
    const body = panelEl.querySelector(".chan-body");
    body.innerHTML = loadingBox();

    const [ads, shop, runs] = await Promise.all([
      fetchAds(period),
      fetchShopTotals(period),
      fetchSyncStatus(),
    ]);

    const sync = syncStateFor(runs.rows, "catchr");
    panelEl.querySelector(".chan-badge").innerHTML = syncBadge(sync);
    panelEl.querySelector(".chan-sync").innerHTML = syncLine(sync, "Catchr sync");

    if (ads.error) {
      body.innerHTML = errorBox(ads.error, "Check that migration 0004 has been run in Supabase.");
      return;
    }

    const rows = ads.rows.filter((r) => r.platform === platform);
    const extraHtml = extraBlocks ? await extraBlocks() : "";

    if (!rows.length) {
      body.innerHTML = extraHtml + notConnected;
      return;
    }

    const available = daysAvailable();
    const t = adTotals(rows);
    const storeNet = shopTotals(shop.rows).net;
    const m = adMetrics(t, storeNet);

    const todayIso = new Date().toISOString().slice(0, 10);
    const daily = bucketSeries(rows, grain, (r) => ({
      spend: Number(r.cost) || 0,
      attributed: Number(r.attributed_sales) || 0,
      clicks: Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
    })).map((b) => {
      const partial = isPartialBucket(b.key, grain, DATA_START, todayIso);
      return { ...b, partial, tipLabel: partial ? `${b.label} (partial)` : b.label };
    });

    const campaigns = collapse(rows);

    body.innerHTML = `
      ${extraHtml}
      <div class="hero chan-hero"></div>
      <div class="kpi-grid chan-kpis"></div>

      <div class="card">
        <div class="card-head">
          <h3>Spend vs attributed revenue</h3>
          <span class="hint">${daily.length ? `${daily[0].label} – ${daily[daily.length - 1].label}` : "—"} · hover to inspect</span>
        </div>
        <div class="card-body">
          <svg class="chart chan-chart"></svg>
          <div class="legend">
            <span><span class="dot ink"></span>Spend</span>
            <span><span class="dot accent"></span>Platform-attributed revenue</span>
          </div>
        </div>
      </div>

      <div class="insight">
        <div class="ico">i</div>
        <div class="body">
          Attributed revenue here comes from ${escapeHtml(title)}'s own tracking, which can see the
          <strong>Shopify storefront</strong> but <strong>not Amazon</strong>. If this traffic buys on
          Amazon, the sale is invisible to it. Judge the channel on whether storefront revenue moves
          with spend, not on the ROAS below alone.
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Campaigns</h3><span class="hint">${campaigns.length} in window</span></div>
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
                  <th class="num">Conv.</th>
                  <th class="num">ROAS</th>
                </tr>
              </thead>
              <tbody>
                ${campaigns.map((c) => `
                  <tr>
                    <td class="ink">${escapeHtml(c.name)}</td>
                    <td class="num"><strong>${fmtCurrency(c.cost)}</strong></td>
                    <td class="num">${fmtNumber(c.impressions)}</td>
                    <td class="num">${fmtNumber(c.clicks)}</td>
                    <td class="num">${fmtPercent(c.ctr)}</td>
                    <td class="num">${fmtCurrency(c.cpc)}</td>
                    <td class="num">${fmtCurrency(c.sales)}</td>
                    <td class="num">${fmtNumber(c.orders)}</td>
                    <td class="num ${roasTone(c.roas)}">${fmtRatio(c.roas)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    panelEl.querySelector(".chan-hero").innerHTML = `
      <div class="eyebrow">${escapeHtml(title)} spend · ${escapeHtml(periodLabel(period, available))}</div>
      <div class="figure">
        <div class="number">${fmtCurrency(t.cost)}</div>
        <span class="delta">${fmtNumber(t.clicks)} clicks · ${fmtCurrency(m.cpc)} CPC</span>
      </div>
      <div class="sub">${fmtNumber(t.impressions)} impressions · ${fmtPercent(m.ctr)} CTR · ${fmtNumber(t.orders)} attributed conversions</div>
      <div class="spark-wrap"><svg class="spark chan-spark"></svg></div>
    `;

    panelEl.querySelector(".chan-kpis").innerHTML = [
      kpi("Attributed revenue", fmtCurrency(t.sales), t.sales === 0 ? "none reported" : "", t.sales === 0 ? "val-warn" : ""),
      kpi("ROAS", fmtRatio(m.roas), "platform-reported", roasTone(m.roas)),
      kpi("Cost per click", fmtCurrency(m.cpc), `${fmtPercent(m.ctr)} CTR`),
      kpi("Share of storefront", m.tacos == null ? "—" : fmtPercent(m.tacos), `on ${fmtCurrency(storeNet)} Shopify net`),
    ].join("");

    lastRender = {
      daily,
      exportData: {
        name: platform, grain,
        rows: daily.map((b) => ({
          bucket: b.label, key: b.key, partial: b.partial ? "yes" : "",
          spend: (b.spend || 0).toFixed(2), attributed_revenue: (b.attributed || 0).toFixed(2),
          clicks: b.clicks || 0, impressions: b.impressions || 0,
        })),
        columns: [
          { key: "bucket", label: grain }, { key: "key", label: "key" }, { key: "partial", label: "partial_bucket" },
          { key: "spend", label: "spend" }, { key: "attributed_revenue", label: "attributed_revenue" },
          { key: "clicks", label: "clicks" }, { key: "impressions", label: "impressions" },
        ],
      },
    };
    redraw();
  }

  function redraw() {
    const chart = panelEl?.querySelector(".chan-chart");
    if (!lastRender || !chart || !lastRender.daily.length) return;
    const { daily } = lastRender;
    renderSpark(panelEl.querySelector(".chan-spark"), daily.map((d) => d.spend));
    renderDualLine(chart, daily, {
      height: 220,
      primaryKey: "spend",
      secondaryKey: "attributed",
      scrub: { primaryName: "Spend", secondaryName: "Attributed", fmt: (v) => fmtCurrency(v),
               extra: (b) => [{ name: "Clicks", value: fmtNumber(b.clicks || 0) }] },
      axisLabels: [
        daily[0].label,
        daily[Math.floor(daily.length / 2)].label,
        daily[daily.length - 1].label,
      ],
    });
  }

  return function mount(el) {
    panelEl = el;
    el.innerHTML = `
      <div class="tab-header">
        <div class="titles">
          <h2>${escapeHtml(title)} <span class="chan-badge"></span></h2>
          <p>${blurb}</p>
          ${floorNote(DATA_START)}
          <div class="chan-sync"></div>
        </div>
        <div class="tab-tools">
          <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
          <div class="chan-grain"></div>
          ${exportButton(`chanExport-${platform}`)}
        </div>
      </div>
      <div class="chan-body">${loadingBox()}</div>
    `;
    el.querySelector(".chan-grain").innerHTML = grainButtons(grain, daysAvailable());
    wirePeriod(el, () => period, (v) => { period = v; }, render);
    wireGrain(el, () => grain, (v) => { grain = v; }, render);
    wireExport(el, `chanExport-${platform}`, () => lastRender?.exportData);
    render();
    // Guarded: auto-refresh re-mounts the tab, and an unguarded
    // registration would stack a new listener on every refresh.
    if (!wiredResize) {
      wiredResize = true;
      window.addEventListener("resize", debounce(() => redraw(), 150));
    }
  };
}

function collapse(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.campaign_id || r.campaign_name || "(unnamed)";
    const slot = map.get(key) || { name: r.campaign_name || key, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
    slot.impressions += Number(r.impressions) || 0;
    slot.clicks += Number(r.clicks) || 0;
    slot.cost += Number(r.cost) || 0;
    slot.sales += Number(r.attributed_sales) || 0;
    slot.orders += Number(r.attributed_orders) || 0;
    map.set(key, slot);
  }
  return [...map.values()]
    .map((c) => ({
      ...c,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
      cpc: c.clicks > 0 ? c.cost / c.clicks : 0,
      roas: c.cost > 0 ? c.sales / c.cost : null,
    }))
    .sort((a, b) => b.cost - a.cost);
}
