// Sales tab — revenue trend, channel split, recent orders.
// Mock data for now; Phase 2 will swap in live Shopify + Amazon SP-API feeds.

import { mockOrders } from "../data/sales.js";
import { fmtCurrency, fmtNumber, fmtPercent, fmtShortDate, fmtDateTime, localDayKey, todayKey } from "../format.js";
import { renderLine, renderBars } from "../charts.js";

let panelEl = null;
let period = 30;

export function mountSales(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>Sales</h2>
        <p>Orders, revenue, and channel performance. <span class="muted">Mock data — wires to live Shopify + Amazon in Phase 2.</span></p>
      </div>
      <div class="controls" style="margin:0;">
        <select id="salesPeriod" aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>
    </div>

    <div class="kpi-grid" id="salesKpis"></div>

    <div class="row-2">
      <div class="chart-card">
        <div class="section-head">
          <div>
            <h4>Revenue</h4>
            <div class="big" id="revBig">—</div>
          </div>
          <span class="hint" id="revRange">—</span>
        </div>
        <svg class="chart" id="revChart"></svg>
        <div class="legend"><span><span class="dot ink"></span>Daily revenue</span></div>
      </div>

      <div class="chart-card">
        <div class="section-head"><h4>Channel split</h4><span class="hint" id="channelHint">—</span></div>
        <svg class="chart" id="channelChart"></svg>
        <div class="legend">
          <span><span class="dot ink"></span>Shopify</span>
          <span><span class="dot accent"></span>Amazon</span>
        </div>
      </div>
    </div>

    <div class="card card-pad">
      <div class="section-head">
        <h3>Recent orders</h3>
        <span class="hint" id="ordersCount">—</span>
      </div>
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
  `;

  el.querySelector("#salesPeriod").addEventListener("change", (e) => {
    period = Number(e.target.value);
    render();
  });

  render();
  // Re-draw charts on resize for crisp scaling.
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

  // Compare to prior equivalent window for delta.
  const prior = ordersForPeriod(period, period);
  const priorRev = prior.reduce((s, o) => s + o.revenue, 0);
  const revDelta = priorRev > 0 ? (totals.revenue - priorRev) / priorRev : 0;

  panelEl.querySelector("#salesKpis").innerHTML = [
    kpi("Revenue", fmtCurrency(totals.revenue), revDelta),
    kpi("Orders", fmtNumber(totals.orders)),
    kpi("Avg order value", fmtCurrency(aov)),
    kpi("Shopify share", fmtPercent(shopShare)),
  ].join("");

  // Revenue trend
  const byDay = groupByLocalDay(orders);
  const series = lastNDayKeys(period).map((k) => ({
    label: k,
    value: byDay.get(k)?.revenue || 0,
  }));
  panelEl.querySelector("#revBig").textContent = fmtCurrency(totals.revenue);
  panelEl.querySelector("#revRange").textContent =
    `${fmtShortDate(series[0].label)} – ${fmtShortDate(series[series.length - 1].label)}`;
  renderLine(panelEl.querySelector("#revChart"), series);

  // Channel split chart — daily stacked-ish via two grouped bars
  const channelDaily = lastNDayKeys(period).map((k) => {
    const v = byDay.get(k);
    return { label: k, shop: v?.shopify || 0, amz: v?.amazon || 0 };
  });
  drawChannelChart(panelEl.querySelector("#channelChart"), channelDaily);
  panelEl.querySelector("#channelHint").textContent =
    `${fmtCurrency(totals.shopRev)} Shopify · ${fmtCurrency(totals.amzRev)} Amazon`;

  // Recent orders (most recent 50)
  const recent = orders.slice(-50).reverse();
  panelEl.querySelector("#ordersCount").textContent = `${orders.length} orders in window`;
  panelEl.querySelector("#ordersBody").innerHTML = recent.length
    ? recent
        .map(
          (o) => `
      <tr>
        <td class="muted">${fmtDateTime(o.ts)}</td>
        <td><span class="sku-cell">${o.id}</span></td>
        <td><span class="chip ${o.channel}">${o.channel}</span></td>
        <td><span class="sku-cell">${o.sku}</span></td>
        <td>${escapeHtml(o.product)}${o.variant && o.variant !== "Standard" ? ` <span class="muted">· ${escapeHtml(o.variant)}</span>` : ""}</td>
        <td class="num">${o.qty}</td>
        <td class="num">${fmtCurrency(o.unitPrice)}</td>
        <td class="num">${fmtCurrency(o.revenue)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="8"><div class="empty">No orders in this window.</div></td></tr>`;
}

function kpi(label, value, delta) {
  const deltaHtml =
    typeof delta === "number"
      ? `<span class="delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${fmtPercent(Math.abs(delta))} vs prior</span>`
      : "";
  return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>${deltaHtml}</div>`;
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
  // n local days ending today (inclusive).
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(localDayKey(d));
  }
  // Replace the last one with todayKey() to ensure inclusion of today's TZ-correct day.
  out[out.length - 1] = todayKey();
  // De-duplicate while preserving order (DST/TZ edge cases).
  return [...new Set(out)];
}

function drawChannelChart(svg, daily) {
  // Render two stacked bars per day: Shopify on bottom (ink), Amazon on top (accent).
  const NS = "http://www.w3.org/2000/svg";
  const width = svg.clientWidth || svg.parentElement.clientWidth || 600;
  const height = 160;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const pad = { top: 10, right: 8, bottom: 18, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / daily.length;
  const barW = Math.max(2, slot * 0.78);
  const max = Math.max(1, ...daily.map((d) => d.shop + d.amz));

  for (let g = 0; g < 4; g++) {
    const y = pad.top + (innerH / 3) * g;
    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", pad.left);
    ln.setAttribute("x2", width - pad.right);
    ln.setAttribute("y1", y);
    ln.setAttribute("y2", y);
    ln.setAttribute("class", "grid");
    svg.appendChild(ln);
  }

  daily.forEach((d, i) => {
    const x = pad.left + slot * i + (slot - barW) / 2;
    const totalH = innerH * ((d.shop + d.amz) / max);
    const shopH = innerH * (d.shop / max);
    const amzH = totalH - shopH;
    const yShop = pad.top + (innerH - shopH);
    const yAmz = pad.top + (innerH - shopH - amzH);

    if (d.shop > 0) {
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", x);
      r.setAttribute("y", yShop);
      r.setAttribute("width", barW);
      r.setAttribute("height", Math.max(0.5, shopH));
      r.setAttribute("rx", 1.5);
      r.setAttribute("class", "bar");
      svg.appendChild(r);
    }
    if (d.amz > 0) {
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", x);
      r.setAttribute("y", yAmz);
      r.setAttribute("width", barW);
      r.setAttribute("height", Math.max(0.5, amzH));
      r.setAttribute("rx", 1.5);
      r.setAttribute("class", "bar alt");
      svg.appendChild(r);
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
