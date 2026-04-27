// Sales tab — hero revenue + sparkline, channel split, recent orders.

import { mockOrders } from "../data/sales.js";
import { fmtCurrency, fmtNumber, fmtPercent, fmtShortDate, fmtDateTime, localDayKey, todayKey } from "../format.js";
import { renderLine, renderSpark, renderStackedBars } from "../charts.js";

let panelEl = null;
let period = 30;

export function mountSales(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Sales <span class="mockbanner">Mock</span></h2>
        <p>Orders, revenue, and channel performance. <span class="muted-inline">Wires to live Shopify + Amazon SP-API in Phase 2.</span></p>
      </div>
      <div class="segmented" role="group" aria-label="Period">
        ${segBtns()}
      </div>
    </div>

    <div class="hero" id="salesHero"></div>

    <div class="kpi-grid" id="salesKpis"></div>

    <div class="row-2">
      <div class="card">
        <div class="card-head">
          <h3>Revenue trend</h3>
          <span class="hint" id="revHint">—</span>
        </div>
        <div class="card-body">
          <svg class="chart" id="revChart"></svg>
          <div class="legend"><span><span class="dot accent"></span>Daily revenue</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Channel split</h3>
          <span class="hint" id="channelHint">—</span>
        </div>
        <div class="card-body">
          <svg class="chart" id="channelChart"></svg>
          <div class="legend">
            <span><span class="dot ink"></span>Shopify</span>
            <span><span class="dot accent"></span>Amazon</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Recent orders</h3>
        <span class="hint" id="ordersCount">—</span>
      </div>
      <div class="card-body flush">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Placed</th>
                <th>Order</th>
                <th>Channel</th>
                <th>SKU</th>
                <th>Product</th>
                <th class="num">Qty</th>
                <th class="num">Unit</th>
                <th class="num">Revenue</th>
              </tr>
            </thead>
            <tbody id="ordersBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  wireSegmented(el, () => render());
  render();
  window.addEventListener("resize", debounce(render, 150));
}

function render() {
  const orders = ordersForPeriod(period);
  const totals = orders.reduce(
    (acc, o) => {
      acc.revenue += o.revenue;
      acc.orders += 1;
      acc.units += o.qty;
      if (o.channel === "amazon") acc.amzRev += o.revenue;
      else acc.shopRev += o.revenue;
      return acc;
    },
    { revenue: 0, orders: 0, units: 0, amzRev: 0, shopRev: 0 },
  );
  const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const shopShare = totals.revenue > 0 ? totals.shopRev / totals.revenue : 0;

  const prior = ordersForPeriod(period, period);
  const priorRev = prior.reduce((s, o) => s + o.revenue, 0);
  const revDelta = priorRev > 0 ? (totals.revenue - priorRev) / priorRev : 0;

  // Hero
  const byDay = groupByLocalDay(orders);
  const dayKeys = lastNDayKeys(period);
  const sparkValues = dayKeys.map((k) => byDay.get(k)?.revenue || 0);

  panelEl.querySelector("#salesHero").innerHTML = `
    <div class="eyebrow">Revenue · last ${period} days</div>
    <div class="figure">
      <div class="number">${fmtCurrency(totals.revenue)}</div>
      ${priorRev > 0 ? `
        <span class="delta ${revDelta >= 0 ? "up" : "down"}">
          <span class="arrow">${revDelta >= 0 ? "▲" : "▼"}</span> ${fmtPercent(Math.abs(revDelta))} vs prior ${period} days
        </span>` : ""}
    </div>
    <div class="sub">${fmtNumber(totals.orders)} orders · ${fmtCurrency(aov)} avg order value</div>
    <div class="spark-wrap"><svg class="spark" id="revSpark"></svg></div>
  `;
  renderSpark(panelEl.querySelector("#revSpark"), sparkValues);

  // KPI strip
  panelEl.querySelector("#salesKpis").innerHTML = [
    kpi("Orders", fmtNumber(totals.orders)),
    kpi("Avg order value", fmtCurrency(aov)),
    kpi("Shopify revenue", fmtCurrency(totals.shopRev), `${fmtPercent(shopShare)} of total`),
    kpi("Amazon revenue", fmtCurrency(totals.amzRev), `${fmtPercent(1 - shopShare)} of total`),
  ].join("");

  // Revenue trend (large)
  const series = dayKeys.map((k) => ({ label: k, value: byDay.get(k)?.revenue || 0 }));
  panelEl.querySelector("#revHint").textContent =
    `${fmtShortDate(series[0].label)} – ${fmtShortDate(series[series.length - 1].label)}`;
  renderLine(panelEl.querySelector("#revChart"), series, {
    height: 220,
    accent: true,
    axisLabels: [
      fmtShortDate(series[0].label),
      fmtShortDate(series[Math.floor(series.length / 2)].label),
      fmtShortDate(series[series.length - 1].label),
    ],
  });

  // Channel split
  const channelDaily = dayKeys.map((k) => {
    const v = byDay.get(k);
    return { label: k, shop: v?.shopify || 0, amz: v?.amazon || 0 };
  });
  renderStackedBars(panelEl.querySelector("#channelChart"), channelDaily, {
    height: 220, primaryKey: "shop", secondaryKey: "amz",
  });
  panelEl.querySelector("#channelHint").textContent =
    `${fmtCurrency(totals.shopRev)} Shopify · ${fmtCurrency(totals.amzRev)} Amazon`;

  // Recent orders
  const recent = orders.slice(-50).reverse();
  panelEl.querySelector("#ordersCount").textContent = `${fmtNumber(orders.length)} orders in window`;
  panelEl.querySelector("#ordersBody").innerHTML = recent.length
    ? recent
        .map(
          (o) => `
      <tr>
        <td class="muted">${fmtDateTime(o.ts)}</td>
        <td><span class="sku-cell">${o.id}</span></td>
        <td><span class="chip ${o.channel}">${o.channel}</span></td>
        <td><span class="sku-cell">${o.sku}</span></td>
        <td class="ink">${escapeHtml(o.product)}${o.variant && o.variant !== "Standard" ? ` <span class="muted">· ${escapeHtml(o.variant)}</span>` : ""}</td>
        <td class="num">${o.qty}</td>
        <td class="num">${fmtCurrency(o.unitPrice)}</td>
        <td class="num"><strong>${fmtCurrency(o.revenue)}</strong></td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="8"><div class="empty">No orders in this window.</div></td></tr>`;
}

function segBtns() {
  return [7, 30, 90].map((d) => `<button data-period="${d}" aria-pressed="${d === 30}">${d}d</button>`).join("");
}

function wireSegmented(el, onChange) {
  el.querySelector(".segmented").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn) return;
    period = Number(btn.dataset.period);
    el.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.period === String(period) ? "true" : "false"));
    onChange();
  });
}

function ordersForPeriod(days, offsetDays = 0) {
  const cutoffEnd = Date.now() - offsetDays * 86400000;
  const cutoffStart = cutoffEnd - days * 86400000;
  return mockOrders.filter((o) => {
    const t = Date.parse(o.ts);
    return t >= cutoffStart && t < cutoffEnd;
  });
}

function groupByLocalDay(orders) {
  const map = new Map();
  for (const o of orders) {
    const key = localDayKey(o.ts);
    if (!map.has(key)) map.set(key, { revenue: 0, amazon: 0, shopify: 0, orders: 0 });
    const slot = map.get(key);
    slot.revenue += o.revenue;
    slot.orders += 1;
    slot[o.channel] += o.revenue;
  }
  return map;
}

function lastNDayKeys(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(localDayKey(d));
  }
  out[out.length - 1] = todayKey();
  return [...new Set(out)];
}

function kpi(label, value, foot, tone = "") {
  return `
    <div class="kpi">
      <span class="label">${label}</span>
      <span class="value">${value}</span>
      ${foot ? `<span class="foot ${tone}">${foot}</span>` : ""}
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
