// Inventory tab — hero summary + KPI grid + filterable catalog table.

import { seedInventory, sockVersionDefinitions } from "../data/inventory.js";
import { getState, updateRow, resetQuantities, subscribe } from "../state.js";
import { fmtNumber } from "../format.js";

let panelEl = null;
let filterState = { q: "", channel: "all" };

export function mountInventory(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Inventory</h2>
        <p>Live stock across Amazon and Shopify. Edit quantities inline; everything saves locally.</p>
      </div>
    </div>

    <div class="hero" id="invHero"></div>

    <div class="kpi-grid" id="invKpis"></div>

    <div class="row-2">
      <div class="card">
        <div class="card-head">
          <h3>Catalog</h3>
          <span class="hint" id="invCount">—</span>
        </div>
        <div class="card-body">
          <div class="controls" style="margin-bottom: 14px;">
            <input type="search" id="invSearch" placeholder="Search SKU, product, variant, category…" />
            <select id="invChannel">
              <option value="all">All channels</option>
              <option value="amazon">Amazon only</option>
              <option value="shopify">Shopify only</option>
              <option value="both">Stocked on both</option>
            </select>
            <span style="flex:1"></span>
            <button class="btn ghost danger" id="invReset">Reset</button>
            <button class="btn primary" id="invExport">Export CSV</button>
          </div>
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

      <div class="card">
        <div class="card-head"><h3>Compression sock guide</h3></div>
        <div class="card-body">
          <div style="display:grid; gap:12px;">
            ${sockVersionDefinitions
              .map((v) => `
                <div>
                  <div style="font-weight:600; color: var(--ink); font-size:13px;">${v.name}</div>
                  <div class="muted" style="font-size:12.5px; line-height:1.45; margin-top:2px;">${v.description.replace(v.name + " — ", "")}</div>
                </div>`)
              .join("")}
          </div>
          <p class="muted" style="font-size: 12px; margin: 18px 0 0; padding-top: 14px; border-top: 1px solid var(--line);">
            Sizes 1–5 and colors Black / Beige apply to every version. <strong style="color: var(--ink-2);">40 sock variants</strong> in the catalog.
          </p>
        </div>
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
      renderHero();
      renderKpis();
      renderTable();
    }
  });

  renderHero();
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

function renderHero() {
  const all = rowsWithState();
  const totalUnits = all.reduce((s, r) => s + r.total, 0);
  const lowCount = all.filter((r) => r.status === "Low").length;
  const watchCount = all.filter((r) => r.status === "Watch").length;
  const healthy = all.length - lowCount - watchCount;
  const lowPct = all.length > 0 ? (lowCount / all.length) : 0;

  const status = lowCount > 0
    ? { tone: "down", text: `${lowCount} SKU${lowCount === 1 ? "" : "s"} below reorder` }
    : { tone: "up", text: "All SKUs at or above reorder" };

  panelEl.querySelector("#invHero").innerHTML = `
    <div class="eyebrow">Total inventory on hand</div>
    <div class="figure">
      <div class="number">${fmtNumber(totalUnits)}</div>
      <span class="delta ${status.tone}">
        <span class="arrow">${status.tone === "up" ? "✓" : "!"}</span> ${status.text}
      </span>
    </div>
    <div class="sub">${all.length} SKUs tracked · ${healthy} healthy · ${watchCount} on watch · ${lowCount} low</div>
  `;
}

function renderKpis() {
  const all = rowsWithState();
  const totals = all.reduce(
    (acc, r) => {
      acc.amazon += r.amazon;
      acc.shopify += r.shopify;
      if (r.status === "Low") acc.low++;
      if (r.status === "Watch") acc.watch++;
      return acc;
    },
    { amazon: 0, shopify: 0, low: 0, watch: 0 },
  );
  const cards = [
    { label: "Amazon Units", value: fmtNumber(totals.amazon) },
    { label: "Shopify Units", value: fmtNumber(totals.shopify) },
    { label: "Low Stock", value: fmtNumber(totals.low), foot: totals.low > 0 ? "down" : "" },
    { label: "On Watch", value: fmtNumber(totals.watch) },
  ];
  panelEl.querySelector("#invKpis").innerHTML = cards
    .map(
      (c) => `
      <div class="kpi">
        <span class="label">${c.label}</span>
        <span class="value">${c.value}</span>
      </div>`,
    )
    .join("");
}

function renderTable() {
  const all = rowsWithState();
  const rows = applyFilters(all);
  const body = panelEl.querySelector("#invBody");
  panelEl.querySelector("#invCount").textContent = `${rows.length} of ${all.length}`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty">No SKUs match your filters.</div></td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (r) => `
      <tr class="${r.status === "Low" ? "row-low" : ""}" data-sku="${r.sku}">
        <td><span class="sku-cell">${r.sku}</span></td>
        <td class="ink">${escapeHtml(r.product)}</td>
        <td class="muted">${escapeHtml(r.variant)}</td>
        <td class="num"><input type="number" min="0" data-field="amazon" value="${r.amazon}" /></td>
        <td class="num"><input type="number" min="0" data-field="shopify" value="${r.shopify}" /></td>
        <td class="num ink"><strong>${fmtNumber(r.total)}</strong></td>
        <td class="num"><input type="number" min="0" data-field="reorderLevel" value="${r.reorderLevel}" /></td>
        <td><span class="status ${statusClass(r.status)}">${r.status}</span></td>
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

function csvSafe(v) { return `"${String(v ?? "").replaceAll('"', '""')}"`; }
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
