// Products tab — popularity ranking, units sold, sock variant analysis.

import { mockOrders } from "../data/sales.js";
import { skuMap } from "../data/inventory.js";
import { fmtCurrency, fmtNumber } from "../format.js";
import { renderBars } from "../charts.js";

let panelEl = null;
let period = 30;

export function mountProducts(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>Products</h2>
        <p>What's selling, what's not, and which sock variants pull the most weight.</p>
      </div>
      <div class="controls" style="margin:0;">
        <select id="prodPeriod" aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>
    </div>

    <div class="kpi-grid" id="prodKpis"></div>

    <div class="row-2">
      <div class="card card-pad">
        <div class="section-head"><h3>Top sellers</h3><span class="hint">By units sold</span></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>SKU</th>
                <th>Product</th>
                <th>Variant</th>
                <th class="num">Units</th>
                <th class="num">Orders</th>
                <th class="num">Revenue</th>
                <th class="num">% of revenue</th>
              </tr>
            </thead>
            <tbody id="topBody"></tbody>
          </table>
        </div>
      </div>

      <div class="card card-pad">
        <div class="section-head"><h3>Category mix</h3><span class="hint">Revenue share</span></div>
        <div id="catMix"></div>
        <div class="insight" style="margin-top: 14px;" id="catInsight"></div>
      </div>
    </div>

    <div class="row-3">
      <div class="chart-card">
        <div class="section-head"><h4>Best sock version</h4><span class="hint" id="versionHint">—</span></div>
        <svg class="chart" id="versionChart"></svg>
      </div>
      <div class="chart-card">
        <div class="section-head"><h4>Best sock size</h4><span class="hint" id="sizeHint">—</span></div>
        <svg class="chart" id="sizeChart"></svg>
      </div>
      <div class="chart-card">
        <div class="section-head"><h4>Color preference</h4><span class="hint" id="colorHint">—</span></div>
        <svg class="chart" id="colorChart"></svg>
      </div>
    </div>
  `;

  el.querySelector("#prodPeriod").addEventListener("change", (e) => {
    period = Number(e.target.value);
    render();
  });
  render();
  window.addEventListener("resize", debounce(render, 150));
}

function render() {
  const orders = ordersForPeriod(period);
  const totalRev = orders.reduce((s, o) => s + o.revenue, 0);
  const uniqueSkus = new Set(orders.map((o) => o.sku)).size;
  const totalUnits = orders.reduce((s, o) => s + o.qty, 0);
  const avgUnitsPerOrder = orders.length > 0 ? totalUnits / orders.length : 0;

  panelEl.querySelector("#prodKpis").innerHTML = [
    kpi("SKUs sold", fmtNumber(uniqueSkus), `of ${skuMap.size} tracked`),
    kpi("Units sold", fmtNumber(totalUnits)),
    kpi("Avg units / order", avgUnitsPerOrder.toFixed(2)),
    kpi("Revenue", fmtCurrency(totalRev)),
  ].join("");

  // Top sellers table by units
  const bySku = new Map();
  for (const o of orders) {
    if (!bySku.has(o.sku)) bySku.set(o.sku, { sku: o.sku, product: o.product, variant: o.variant, units: 0, orders: 0, revenue: 0 });
    const slot = bySku.get(o.sku);
    slot.units += o.qty;
    slot.orders += 1;
    slot.revenue += o.revenue;
  }
  const top = [...bySku.values()].sort((a, b) => b.units - a.units).slice(0, 12);
  const topBody = panelEl.querySelector("#topBody");
  topBody.innerHTML = top.length
    ? top
        .map(
          (r, i) => `
        <tr>
          <td class="muted">${i + 1}</td>
          <td><span class="sku-cell">${r.sku}</span></td>
          <td>${escapeHtml(r.product)}</td>
          <td class="muted">${escapeHtml(r.variant)}</td>
          <td class="num">${fmtNumber(r.units)}</td>
          <td class="num">${fmtNumber(r.orders)}</td>
          <td class="num">${fmtCurrency(r.revenue)}</td>
          <td class="num">${totalRev > 0 ? ((r.revenue / totalRev) * 100).toFixed(1) : "0"}%</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="8"><div class="empty">No sales in this window.</div></td></tr>`;

  // Category mix
  const byCat = new Map();
  for (const o of orders) {
    byCat.set(o.category, (byCat.get(o.category) || 0) + o.revenue);
  }
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  panelEl.querySelector("#catMix").innerHTML = catRows.length
    ? catRows
        .map(
          ([cat, rev]) => {
            const pct = totalRev > 0 ? (rev / totalRev) * 100 : 0;
            return `
            <div style="margin-bottom: 14px;">
              <div style="display:flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                <span>${escapeHtml(cat)}</span>
                <span class="tnum"><span class="muted">${fmtCurrency(rev)} · </span>${pct.toFixed(1)}%</span>
              </div>
              <div style="background: var(--bg-2); border-radius: 4px; height: 8px; overflow:hidden;">
                <div style="width:${pct}%; height: 100%; background: var(--accent);"></div>
              </div>
            </div>`;
          },
        )
        .join("")
    : `<div class="empty">No sales in this window.</div>`;

  if (catRows.length) {
    const [topCat, topRev] = catRows[0];
    const pct = totalRev > 0 ? ((topRev / totalRev) * 100).toFixed(0) : 0;
    panelEl.querySelector("#catInsight").innerHTML = `
      <div class="ico">★</div>
      <div class="body"><strong>${escapeHtml(topCat)}</strong> is your strongest category, contributing <strong>${pct}%</strong> of revenue across the last ${period} days.</div>
    `;
  } else {
    panelEl.querySelector("#catInsight").innerHTML = "";
  }

  // Sock variant analysis
  const sockOrders = orders.filter((o) => o.category === "Compression");
  const sockUnits = sockOrders.reduce((s, o) => s + o.qty, 0);
  const versionTotals = new Map();
  const sizeTotals = new Map();
  const colorTotals = new Map();

  for (const o of sockOrders) {
    const [versionLabel, sizeLabel, colorLabel] = o.variant.split(" | ").map((s) => s.trim());
    versionTotals.set(versionLabel, (versionTotals.get(versionLabel) || 0) + o.qty);
    sizeTotals.set(sizeLabel, (sizeTotals.get(sizeLabel) || 0) + o.qty);
    colorTotals.set(colorLabel, (colorTotals.get(colorLabel) || 0) + o.qty);
  }

  drawSockBar(panelEl.querySelector("#versionChart"), [...versionTotals.entries()].sort((a, b) => b[1] - a[1]));
  drawSockBar(panelEl.querySelector("#sizeChart"), [...sizeTotals.entries()].sort((a, b) => b[1] - a[1]));
  drawSockBar(panelEl.querySelector("#colorChart"), [...colorTotals.entries()].sort((a, b) => b[1] - a[1]));

  panelEl.querySelector("#versionHint").textContent =
    sockUnits > 0 ? `${fmtNumber(sockUnits)} sock units · top: ${[...versionTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—"}` : "No sock sales";
  panelEl.querySelector("#sizeHint").textContent =
    sockUnits > 0 ? `top: ${[...sizeTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—"}` : "—";
  panelEl.querySelector("#colorHint").textContent =
    sockUnits > 0 ? `top: ${[...colorTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—"}` : "—";
}

function drawSockBar(svg, entries) {
  const series = entries.map(([label, value]) => ({ label: shortLabel(label), value }));
  renderBars(svg, series, { height: 160, accent: false, valueFmt: (v) => fmtNumber(v) });
}

function shortLabel(s) {
  if (s.startsWith("Knee High Closed")) return "KHC";
  if (s.startsWith("Knee High Open")) return "KHO";
  if (s.startsWith("Thigh High Closed")) return "THC";
  if (s.startsWith("Thigh High Open")) return "THO";
  return s.replace("Size ", "S");
}

function ordersForPeriod(days) {
  const cutoff = Date.now() - days * 86400000;
  return mockOrders.filter((o) => Date.parse(o.ts) >= cutoff);
}

function kpi(label, value, foot) {
  return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>${foot ? `<span class="delta">${foot}</span>` : ""}</div>`;
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
