// Margins tab — manual COGS entry, per-SKU profit, blended margin.

import { seedInventory } from "../data/inventory.js";
import { mockOrders } from "../data/sales.js";
import { getState, updateRow, subscribe } from "../state.js";
import { fmtCurrency, fmtNumber, fmtPercent } from "../format.js";

let panelEl = null;
let period = 30;
let q = "";
let filter = "all";

export function mountMargins(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Margins</h2>
        <p>Enter cost-of-goods per SKU; profit per unit and gross margin update live.
        <span class="muted-inline">Stored locally; will sync to your backend in Phase 2.</span></p>
      </div>
      <div class="segmented" role="group" aria-label="Period">
        ${[7, 30, 90].map((d) => `<button data-period="${d}" aria-pressed="${d === 30}">${d}d</button>`).join("")}
      </div>
    </div>

    <div class="hero" id="marHero"></div>

    <div class="kpi-grid" id="marKpis"></div>

    <div class="insight" id="cogsNudge" style="display:none;"></div>

    <div class="card">
      <div class="card-head">
        <h3>Profit per SKU</h3>
        <span class="hint" id="periodHint">—</span>
      </div>
      <div class="card-body">
        <div class="controls" style="margin-bottom: 0;">
          <input type="search" id="marSearch" placeholder="Search SKU, product, variant…" />
          <select id="marFilter">
            <option value="all">All SKUs</option>
            <option value="missing">Missing COGS</option>
            <option value="entered">COGS entered</option>
            <option value="active">With sales in window</option>
          </select>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Variant</th>
              <th class="num">Retail</th>
              <th class="num">COGS</th>
              <th class="num">Margin / unit</th>
              <th class="num">Margin %</th>
              <th class="num">Units sold</th>
              <th class="num">Gross profit</th>
            </tr>
          </thead>
          <tbody id="marBody"></tbody>
        </table>
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

  el.querySelector("#marSearch").addEventListener("input", (e) => {
    q = e.target.value.trim().toLowerCase();
    renderTable();
  });
  el.querySelector("#marFilter").addEventListener("change", (e) => {
    filter = e.target.value;
    renderTable();
  });

  subscribe(() => {
    if (panelEl) {
      renderHero();
      renderKpis();
      renderTable();
    }
  });

  render();
}

function render() {
  renderHero();
  renderKpis();
  renderTable();
}

function periodSales() {
  const cutoff = Date.now() - period * 86400000;
  const map = new Map();
  for (const o of mockOrders) {
    if (Date.parse(o.ts) < cutoff) continue;
    if (!map.has(o.sku)) map.set(o.sku, { units: 0, revenue: 0 });
    const slot = map.get(o.sku);
    slot.units += o.qty; slot.revenue += o.revenue;
  }
  return map;
}

function buildRows() {
  const sales = periodSales();
  const { inventory } = getState();
  return seedInventory.map((row) => {
    const s = inventory[row.sku];
    const sale = sales.get(row.sku) || { units: 0, revenue: 0 };
    const stockOnHand = s.amazon + s.shopify;
    const retail = row.suggestedPrice;
    const cogs = s.cogs || 0;
    const marginPerUnit = retail - cogs;
    const marginPct = retail > 0 ? marginPerUnit / retail : 0;
    const grossProfit = cogs > 0 ? sale.units * marginPerUnit : 0;
    return {
      ...row, stockOnHand, retail, cogs,
      marginPerUnit, marginPct,
      unitsSold: sale.units, revenue: sale.revenue,
      grossProfit, hasCogs: cogs > 0,
    };
  });
}

function renderHero() {
  const rows = buildRows();
  const periodRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const periodGrossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
  const blendedMargin = periodRevenue > 0 ? periodGrossProfit / periodRevenue : 0;
  const totalCogsCovered = rows.filter((r) => r.hasCogs).length;
  const coverage = rows.length > 0 ? totalCogsCovered / rows.length : 0;

  panelEl.querySelector("#marHero").innerHTML = `
    <div class="eyebrow">Estimated gross profit · last ${period} days</div>
    <div class="figure">
      <div class="number">${fmtCurrency(periodGrossProfit)}</div>
      <span class="delta">${fmtPercent(blendedMargin)} blended margin</span>
    </div>
    <div class="sub">${fmtCurrency(periodRevenue)} revenue · ${totalCogsCovered} of ${rows.length} SKUs have COGS entered (${fmtPercent(coverage)})</div>
  `;
}

function renderKpis() {
  const rows = buildRows();
  const inventoryValueAtRetail = rows.reduce((s, r) => s + r.stockOnHand * r.retail, 0);
  const inventoryValueAtCost = rows.reduce((s, r) => s + r.stockOnHand * r.cogs, 0);
  const periodRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const periodGrossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
  const totalCogsCovered = rows.filter((r) => r.hasCogs).length;
  const coverage = rows.length > 0 ? totalCogsCovered / rows.length : 0;

  panelEl.querySelector("#marKpis").innerHTML = [
    kpi("Inventory at retail", fmtCurrency(inventoryValueAtRetail)),
    kpi("Inventory at cost", inventoryValueAtCost > 0 ? fmtCurrency(inventoryValueAtCost) : "—", inventoryValueAtCost > 0 ? "" : "Add COGS to compute"),
    kpi("Revenue (window)", fmtCurrency(periodRevenue)),
    kpi("COGS coverage", fmtPercent(coverage), `${totalCogsCovered} of ${rows.length} SKUs`),
  ].join("");

  // Nudge banner
  const missing = rows.length - totalCogsCovered;
  const nudge = panelEl.querySelector("#cogsNudge");
  if (missing > 0) {
    nudge.style.display = "flex";
    nudge.innerHTML = `
      <div class="ico">!</div>
      <div class="body">
        <strong>${missing} of ${rows.length} SKUs</strong> are missing a cost. Profit and margin reflect only SKUs with COGS entered.
        Filter the table by <em>Missing COGS</em> to fill them in.
      </div>`;
  } else {
    nudge.style.display = "none";
  }
}

function renderTable() {
  panelEl.querySelector("#periodHint").textContent = `Sales window: last ${period} days`;
  const all = buildRows();
  const rows = all.filter((r) => {
    const matches =
      !q ||
      r.sku.toLowerCase().includes(q) ||
      r.product.toLowerCase().includes(q) ||
      r.variant.toLowerCase().includes(q);
    if (!matches) return false;
    if (filter === "missing") return !r.hasCogs;
    if (filter === "entered") return r.hasCogs;
    if (filter === "active") return r.unitsSold > 0;
    return true;
  });

  const body = panelEl.querySelector("#marBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty">No SKUs match.</div></td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (r) => `
      <tr data-sku="${r.sku}">
        <td><span class="sku-cell">${r.sku}</span></td>
        <td class="ink">${escapeHtml(r.product)}</td>
        <td class="muted">${escapeHtml(r.variant)}</td>
        <td class="num">${fmtCurrency(r.retail)}</td>
        <td class="num">
          <input type="number" min="0" step="0.01" data-field="cogs"
                 value="${r.cogs ? r.cogs.toFixed(2) : ""}" placeholder="—" />
        </td>
        <td class="num">${r.hasCogs ? fmtCurrency(r.marginPerUnit) : `<span class="muted">—</span>`}</td>
        <td class="num">${
          r.hasCogs
            ? `<span class="mpill ${r.marginPct >= 0.5 ? "ok" : r.marginPct >= 0.25 ? "watch" : "low"}">${fmtPercent(r.marginPct)}</span>`
            : `<span class="muted">—</span>`
        }</td>
        <td class="num">${fmtNumber(r.unitsSold)}</td>
        <td class="num">${r.hasCogs ? `<strong>${fmtCurrency(r.grossProfit)}</strong>` : `<span class="muted">—</span>`}</td>
      </tr>`,
    )
    .join("");

  body.querySelectorAll("input[type='number']").forEach((input) => {
    input.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");
      updateRow(tr.dataset.sku, { cogs: e.target.value });
    });
  });
}

function kpi(label, value, foot) {
  return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>${foot ? `<span class="foot">${foot}</span>` : ""}</div>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
