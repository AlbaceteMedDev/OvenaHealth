// Margins tab — manual COGS entry, per-SKU profit, blended margin.

import { seedInventory } from "../data/inventory.js";
import { mockOrders } from "../data/sales.js";
import { getState, updateRow, subscribe } from "../state.js";
import { fmtCurrency, fmtNumber, fmtPercent } from "../format.js";

let panelEl = null;
let period = 30;

export function mountMargins(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>Margins</h2>
        <p>Enter cost-of-goods per SKU; profit per unit and gross margin update live.
        <span class="muted">Stored locally; will sync to your backend in Phase 2.</span></p>
      </div>
      <div class="controls" style="margin:0;">
        <select id="marPeriod" aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>
    </div>

    <div class="kpi-grid" id="marKpis"></div>

    <div class="insight" style="margin-bottom: 18px;" id="cogsNudge"></div>

    <div class="card card-pad">
      <div class="section-head">
        <h3>Profit per SKU</h3>
        <span class="hint" id="periodHint">—</span>
      </div>
      <div class="controls">
        <input type="search" id="marSearch" placeholder="Search SKU, product, variant…" />
        <select id="marFilter">
          <option value="all">All SKUs</option>
          <option value="missing">Missing COGS</option>
          <option value="entered">COGS entered</option>
          <option value="active">With sales in window</option>
        </select>
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

  let q = "", filter = "all";

  el.querySelector("#marPeriod").addEventListener("change", (e) => {
    period = Number(e.target.value);
    render();
  });
  el.querySelector("#marSearch").addEventListener("input", (e) => {
    q = e.target.value.trim().toLowerCase();
    renderTable(q, filter);
  });
  el.querySelector("#marFilter").addEventListener("change", (e) => {
    filter = e.target.value;
    renderTable(q, filter);
  });

  subscribe(() => {
    if (panelEl) {
      renderKpis();
      renderTable(q, filter);
    }
  });

  render();

  function render() {
    renderKpis();
    renderTable(q, filter);
  }
}

function periodSales() {
  const cutoff = Date.now() - period * 86400000;
  const map = new Map();
  for (const o of mockOrders) {
    if (Date.parse(o.ts) < cutoff) continue;
    if (!map.has(o.sku)) map.set(o.sku, { units: 0, revenue: 0 });
    const slot = map.get(o.sku);
    slot.units += o.qty;
    slot.revenue += o.revenue;
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
      ...row,
      stockOnHand,
      retail,
      cogs,
      marginPerUnit,
      marginPct,
      unitsSold: sale.units,
      revenue: sale.revenue,
      grossProfit,
      hasCogs: cogs > 0,
    };
  });
}

function renderKpis() {
  const rows = buildRows();
  const totalCogsCovered = rows.filter((r) => r.hasCogs).length;
  const inventoryValueAtRetail = rows.reduce((s, r) => s + r.stockOnHand * r.retail, 0);
  const inventoryValueAtCost = rows.reduce((s, r) => s + r.stockOnHand * r.cogs, 0);
  const periodRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const periodGrossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
  const blendedMargin = periodRevenue > 0 ? periodGrossProfit / periodRevenue : 0;
  const coverage = rows.length > 0 ? totalCogsCovered / rows.length : 0;

  panelEl.querySelector("#marKpis").innerHTML = [
    kpi("Inventory value (retail)", fmtCurrency(inventoryValueAtRetail), inventoryValueAtCost > 0 ? `${fmtCurrency(inventoryValueAtCost)} at cost` : "Add COGS to compute"),
    kpi("Gross profit", fmtCurrency(periodGrossProfit), `${fmtCurrency(periodRevenue)} revenue`),
    kpi("Blended margin", fmtPercent(blendedMargin)),
    kpi("COGS coverage", fmtPercent(coverage), `${totalCogsCovered} of ${rows.length} SKUs`),
  ].join("");

  const missing = rows.length - totalCogsCovered;
  const nudge = panelEl.querySelector("#cogsNudge");
  if (missing > 0) {
    nudge.style.display = "";
    nudge.innerHTML = `
      <div class="ico">!</div>
      <div class="body">
        <strong>${missing} of ${rows.length} SKUs</strong> are missing a cost. Profit and margin numbers reflect only the SKUs with COGS entered.
        Filter the table by <em>Missing COGS</em> to fill them in.
      </div>`;
  } else {
    nudge.style.display = "none";
  }
}

function renderTable(q, filter) {
  panelEl.querySelector("#periodHint").textContent =
    `Sales window: last ${period} days`;
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
        <td>${escapeHtml(r.product)}</td>
        <td class="muted">${escapeHtml(r.variant)}</td>
        <td class="num">${fmtCurrency(r.retail)}</td>
        <td class="num">
          <input type="number" min="0" step="0.01" data-field="cogs"
                 value="${r.cogs ? r.cogs.toFixed(2) : ""}" placeholder="—" />
        </td>
        <td class="num ${r.hasCogs ? (r.marginPerUnit < 0 ? "muted" : "") : "muted"}">
          ${r.hasCogs ? fmtCurrency(r.marginPerUnit) : "—"}
        </td>
        <td class="num">
          ${r.hasCogs
            ? `<span class="pill ${r.marginPct >= 0.5 ? "ok" : r.marginPct >= 0.25 ? "watch" : "low"}">${fmtPercent(r.marginPct)}</span>`
            : `<span class="muted">—</span>`}
        </td>
        <td class="num">${fmtNumber(r.unitsSold)}</td>
        <td class="num">${r.hasCogs ? fmtCurrency(r.grossProfit) : `<span class="muted">—</span>`}</td>
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
  return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>${foot ? `<span class="delta">${foot}</span>` : ""}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
