// Products tab — top sellers, category mix, sock variant analysis.

import { mockOrders } from "../data/sales.js";
import { skuMap } from "../data/inventory.js";
import { fmtCurrency, fmtNumber } from "../format.js";
import { renderBars, renderSpark } from "../charts.js";

let panelEl = null;
let period = 30;

export function mountProducts(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Products <span class="mockbanner">Mock</span></h2>
        <p>What's selling, what's not, and which sock variants pull the most weight.</p>
      </div>
      <div class="segmented" role="group" aria-label="Period">
        ${[7, 30, 90].map((d) => `<button data-period="${d}" aria-pressed="${d === 30}">${d}d</button>`).join("")}
      </div>
    </div>

    <div class="hero" id="prodHero"></div>

    <div class="kpi-grid" id="prodKpis"></div>

    <div class="row-2">
      <div class="card">
        <div class="card-head"><h3>Top sellers</h3><span class="hint">By units sold</span></div>
        <div class="card-body flush">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Variant</th>
                  <th class="num">Units</th>
                  <th class="num">Orders</th>
                  <th class="num">Revenue</th>
                  <th class="num">% rev</th>
                </tr>
              </thead>
              <tbody id="topBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Category mix</h3><span class="hint">Revenue share</span></div>
        <div class="card-body" id="catMix"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 22px;">
      <div class="card-head">
        <h3>Compression sock breakdown</h3>
        <span class="hint" id="sockHint">—</span>
      </div>
      <div class="card-body" style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 24px;">
        <div>
          <div class="muted" style="font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;">By version</div>
          <svg class="chart" id="versionChart" style="height:180px;"></svg>
        </div>
        <div>
          <div class="muted" style="font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;">By size</div>
          <svg class="chart" id="sizeChart" style="height:180px;"></svg>
        </div>
        <div>
          <div class="muted" style="font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;">By color</div>
          <svg class="chart" id="colorChart" style="height:180px;"></svg>
        </div>
      </div>
    </div>
  `;

  el.querySelector(".segmented").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn) return;
    period = Number(btn.dataset.period);
    el.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.period === String(period) ? "true" : "false"));
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

  // Top SKU
  const bySku = new Map();
  for (const o of orders) {
    if (!bySku.has(o.sku)) bySku.set(o.sku, { sku: o.sku, product: o.product, variant: o.variant, units: 0, orders: 0, revenue: 0 });
    const s = bySku.get(o.sku);
    s.units += o.qty; s.orders += 1; s.revenue += o.revenue;
  }
  const top = [...bySku.values()].sort((a, b) => b.units - a.units);
  const topSku = top[0];

  // Hero
  const sparkValues = sparkUnits(orders, period);
  panelEl.querySelector("#prodHero").innerHTML = `
    <div class="eyebrow">Units sold · last ${period} days</div>
    <div class="figure">
      <div class="number">${fmtNumber(totalUnits)}</div>
      ${topSku ? `<span class="delta">${escapeHtml(topSku.product)} leads · ${fmtNumber(topSku.units)} units</span>` : ""}
    </div>
    <div class="sub">${uniqueSkus} of ${skuMap.size} SKUs sold · ${avgUnitsPerOrder.toFixed(2)} units / order</div>
    <div class="spark-wrap"><svg class="spark" id="prodSpark"></svg></div>
  `;
  renderSpark(panelEl.querySelector("#prodSpark"), sparkValues);

  // KPIs
  panelEl.querySelector("#prodKpis").innerHTML = [
    kpi("Revenue", fmtCurrency(totalRev)),
    kpi("Orders", fmtNumber(orders.length)),
    kpi("SKUs sold", fmtNumber(uniqueSkus), `of ${skuMap.size}`),
    kpi("Avg / order", avgUnitsPerOrder.toFixed(2)),
  ].join("");

  // Top sellers table
  const topBody = panelEl.querySelector("#topBody");
  topBody.innerHTML = top.length
    ? top
        .slice(0, 12)
        .map(
          (r, i) => `
        <tr>
          <td class="muted">${i + 1}</td>
          <td><span class="sku-cell">${r.sku}</span></td>
          <td class="ink">${escapeHtml(r.product)}</td>
          <td class="muted">${escapeHtml(r.variant)}</td>
          <td class="num"><strong>${fmtNumber(r.units)}</strong></td>
          <td class="num">${fmtNumber(r.orders)}</td>
          <td class="num">${fmtCurrency(r.revenue)}</td>
          <td class="num">${totalRev > 0 ? ((r.revenue / totalRev) * 100).toFixed(1) : "0"}%</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="8"><div class="empty">No sales in this window.</div></td></tr>`;

  // Category mix
  const byCat = new Map();
  for (const o of orders) byCat.set(o.category, (byCat.get(o.category) || 0) + o.revenue);
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  panelEl.querySelector("#catMix").innerHTML = catRows.length
    ? catRows
        .map(([cat, rev]) => {
          const pct = totalRev > 0 ? (rev / totalRev) * 100 : 0;
          return `
            <div class="barline">
              <span class="lbl">${escapeHtml(cat)}</span>
              <span class="track"><span class="fill" style="width:${pct}%"></span></span>
              <span class="pct">${pct.toFixed(1)}%</span>
            </div>
            <div class="muted" style="font-size: 11.5px; margin: -8px 0 14px 110px; font-variant-numeric: tabular-nums;">${fmtCurrency(rev)}</div>
          `;
        })
        .join("")
    : `<div class="empty">No sales in this window.</div>`;

  // Sock variant analysis
  const sockOrders = orders.filter((o) => o.category === "Compression");
  const sockUnits = sockOrders.reduce((s, o) => s + o.qty, 0);
  const versionTotals = new Map();
  const sizeTotals = new Map();
  const colorTotals = new Map();
  for (const o of sockOrders) {
    const [v, sz, c] = o.variant.split(" | ").map((s) => s.trim());
    versionTotals.set(v, (versionTotals.get(v) || 0) + o.qty);
    sizeTotals.set(sz, (sizeTotals.get(sz) || 0) + o.qty);
    colorTotals.set(c, (colorTotals.get(c) || 0) + o.qty);
  }
  drawSockBar(panelEl.querySelector("#versionChart"), [...versionTotals.entries()].sort((a, b) => b[1] - a[1]));
  drawSockBar(panelEl.querySelector("#sizeChart"), [...sizeTotals.entries()].sort((a, b) => b[1] - a[1]));
  drawSockBar(panelEl.querySelector("#colorChart"), [...colorTotals.entries()].sort((a, b) => b[1] - a[1]));
  panelEl.querySelector("#sockHint").textContent = sockUnits > 0
    ? `${fmtNumber(sockUnits)} sock units in window`
    : "No sock sales";
}

function drawSockBar(svg, entries) {
  const series = entries.map(([label, value]) => ({ label: shortLabel(label), value }));
  renderBars(svg, series, { height: 180, accent: true, valueFmt: (v) => fmtNumber(v) });
}

function shortLabel(s) {
  if (s.startsWith("Knee High Closed")) return "KHC";
  if (s.startsWith("Knee High Open")) return "KHO";
  if (s.startsWith("Thigh High Closed")) return "THC";
  if (s.startsWith("Thigh High Open")) return "THO";
  return s.replace("Size ", "S");
}

function sparkUnits(orders, days) {
  const map = new Map();
  for (const o of orders) {
    const day = o.ts.slice(0, 10);
    map.set(day, (map.get(day) || 0) + o.qty);
  }
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    out.push(map.get(day) || 0);
  }
  return out;
}

function ordersForPeriod(days) {
  const cutoff = Date.now() - days * 86400000;
  return mockOrders.filter((o) => Date.parse(o.ts) >= cutoff);
}

function kpi(label, value, foot) {
  return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>${foot ? `<span class="foot">${foot}</span>` : ""}</div>`;
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
