// Inventory tab — editable Amazon/Shopify/reorder, status, search, filter, export.

import { seedInventory, sockVersionDefinitions } from "../data/inventory.js";
import { getState, updateRow, resetQuantities, subscribe } from "../state.js";
import { fmtNumber } from "../format.js";

let filterState = { q: "", channel: "all" };
let panelEl = null;

export function mountInventory(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>Inventory</h2>
        <p>Live stock across Amazon and Shopify. Edit quantities inline; everything saves locally.</p>
      </div>
    </div>

    <div class="kpi-grid" id="invKpis"></div>

    <div class="row-2">
      <div class="card card-pad">
        <div class="section-head">
          <h3>Catalog</h3>
          <span class="hint" id="invCount">—</span>
        </div>
        <div class="controls">
          <input type="search" id="invSearch" placeholder="Search SKU, product, variant, category…" />
          <select id="invChannel">
            <option value="all">All channels</option>
            <option value="amazon">Amazon only</option>
            <option value="shopify">Shopify only</option>
            <option value="both">Stocked on both</option>
          </select>
          <span style="flex:1"></span>
          <button class="btn ghost danger" id="invReset">Reset quantities</button>
          <button class="btn primary" id="invExport">Export CSV</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Variant</th>
                <th class="num">Amazon</th>
                <th class="num">Shopify</th>
                <th class="num">Total</th>
                <th class="num">Reorder</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="invBody"></tbody>
          </table>
        </div>
      </div>

      <div class="sock-guide">
        <h4>Compression Sock Versions</h4>
        <ul>
          ${sockVersionDefinitions
            .map((v) => `<li><b>${v.name}</b>${v.description.replace(v.name + " — ", "")}</li>`)
            .join("")}
        </ul>
        <p class="muted" style="font-size: 12px; margin: 14px 0 0;">
          Sizes 1–5 and colors Black / Beige apply to every version. 80 sock variants in the catalog.
        </p>
      </div>
    </div>
  `;

  el.querySelector("#invSearch").addEventListener("input", (e) => {
    filterState.q = e.target.value.trim().toLowerCase();
    renderTable();
  });
  el.querySelector("#invChannel").addEventListener("change", (e) => {
    filterState.channel = e.target.value;
    renderTable();
  });
  el.querySelector("#invReset").addEventListener("click", () => {
    if (confirm("Reset every Amazon and Shopify quantity to 0?")) resetQuantities();
  });
  el.querySelector("#invExport").addEventListener("click", exportCsv);

  subscribe(() => {
    if (panelEl) {
      renderKpis();
      renderTable();
    }
  });

  renderKpis();
  renderTable();
}

function rowsWithState() {
  const { inventory } = getState();
  return seedInventory.map((row) => {
    const s = inventory[row.sku];
    return {
      ...row,
      amazon: s.amazon,
      shopify: s.shopify,
      reorderLevel: s.reorderLevel,
      total: s.amazon + s.shopify,
      status: statusOf(s.amazon + s.shopify, s.reorderLevel),
    };
  });
}

function statusOf(total, reorder) {
  if (total < reorder) return "Low";
  if (total <= reorder * 1.25) return "Watch";
  return "Healthy";
}

function statusClass(s) {
  return s === "Low" ? "low" : s === "Watch" ? "watch" : "ok";
}

function applyFilters(rows) {
  const { q, channel } = filterState;
  return rows.filter((r) => {
    const matches =
      !q ||
      r.sku.toLowerCase().includes(q) ||
      r.product.toLowerCase().includes(q) ||
      r.variant.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q);
    let matchesCh = true;
    const a = r.amazon > 0, sh = r.shopify > 0;
    if (channel === "amazon") matchesCh = a;
    else if (channel === "shopify") matchesCh = sh;
    else if (channel === "both") matchesCh = a && sh;
    return matches && matchesCh;
  });
}

function renderKpis() {
  const all = rowsWithState();
  const totals = all.reduce(
    (acc, r) => {
      acc.units += r.total;
      acc.amazon += r.amazon;
      acc.shopify += r.shopify;
      if (r.status === "Low") acc.low++;
      if (r.status === "Watch") acc.watch++;
      return acc;
    },
    { units: 0, amazon: 0, shopify: 0, low: 0, watch: 0 },
  );
  const cards = [
    { label: "Total Units", value: fmtNumber(totals.units), foot: `${all.length} SKUs tracked` },
    { label: "Low Stock", value: fmtNumber(totals.low), foot: `${totals.watch} on watch` },
    { label: "Amazon Units", value: fmtNumber(totals.amazon) },
    { label: "Shopify Units", value: fmtNumber(totals.shopify) },
  ];
  panelEl.querySelector("#invKpis").innerHTML = cards
    .map(
      (c) => `
      <div class="kpi">
        <span class="label">${c.label}</span>
        <span class="value">${c.value}</span>
        ${c.foot ? `<span class="delta">${c.foot}</span>` : ""}
      </div>`,
    )
    .join("");
}

function renderTable() {
  const all = rowsWithState();
  const rows = applyFilters(all);
  const body = panelEl.querySelector("#invBody");
  panelEl.querySelector("#invCount").textContent = `${rows.length} of ${all.length} SKUs`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty">No SKUs match your filters.</div></td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (r) => `
      <tr class="${r.status === "Low" ? "row-low" : ""}" data-sku="${r.sku}">
        <td><span class="sku-cell">${r.sku}</span></td>
        <td>${escapeHtml(r.product)}</td>
        <td class="muted">${escapeHtml(r.variant)}</td>
        <td class="num"><input type="number" min="0" data-field="amazon" value="${r.amazon}" /></td>
        <td class="num"><input type="number" min="0" data-field="shopify" value="${r.shopify}" /></td>
        <td class="num">${fmtNumber(r.total)}</td>
        <td class="num"><input type="number" min="0" data-field="reorderLevel" value="${r.reorderLevel}" /></td>
        <td><span class="pill ${statusClass(r.status)}">${r.status}</span></td>
      </tr>`,
    )
    .join("");

  body.querySelectorAll("input[type='number']").forEach((input) => {
    input.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");
      updateRow(tr.dataset.sku, { [e.target.dataset.field]: e.target.value });
    });
  });
}

function exportCsv() {
  const rows = applyFilters(rowsWithState());
  const header = ["SKU", "Product", "Category", "Variant", "Amazon", "Shopify", "Total", "Reorder", "Status"];
  const lines = [header, ...rows.map((r) => [
    r.sku, r.product, r.category, r.variant, r.amazon, r.shopify, r.total, r.reorderLevel, r.status,
  ])];
  const csv = lines.map((l) => l.map(csvSafe).join(",")).join("\n");
  download(csv, `ovena_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
}

function csvSafe(v) {
  const s = String(v ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

function download(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
