// Inventory tab — grouped catalog table with collapsible product families.

import { seedInventory, sockVersionDefinitions } from "../data/inventory.js";
import { getState, updateRow, resetQuantities, subscribe } from "../state.js";
import { fmtNumber } from "../format.js";

let panelEl = null;
let filterState = { q: "", channel: "all" };
const expanded = new Set(); // group keys currently expanded

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

    <div class="card" style="margin-bottom: 18px;">
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
          <button class="btn ghost" id="invExpandAll">Expand all</button>
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

    <div class="sock-key">
      <span class="sock-key-title">Compression sock versions</span>
      ${sockVersionDefinitions
        .map((v) => `
          <span class="sock-key-item"><b>${v.name}</b> ${v.description.replace(v.name + " — ", "").replace(/\.$/, "")}</span>`)
        .join("")}
      <span class="sock-key-foot">Sizes 1–5 · Black / Beige · 40 variants</span>
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
  el.querySelector("#invExpandAll").addEventListener("click", () => {
    const groups = buildGroups();
    const allExpanded = groups.every((g) => g.children.length <= 1 || expanded.has(g.key));
    if (allExpanded) {
      expanded.clear();
      el.querySelector("#invExpandAll").textContent = "Expand all";
    } else {
      for (const g of groups) if (g.children.length > 1) expanded.add(g.key);
      el.querySelector("#invExpandAll").textContent = "Collapse all";
    }
    renderTable();
  });

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

// ─── Data shaping ────────────────────────────────────────────────────

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

// Family lookup based on SKU prefix. Multi-variant SKU families fold into
// one collapsible group; singleton SKUs render as plain rows.
function familyOf(sku) {
  if (sku.startsWith("CWD-")) return "Collagen Wound Dressing";
  if (sku.startsWith("SFD-")) return "Silicone Foam Dressing";
  if (sku.startsWith("CS-")) return "Compression Socks";
  return null;
}

// Group SKUs by family. SKUs with no family are added as their own
// single-child group so the render path stays uniform; the renderer
// shows them as plain rows.
function buildGroups() {
  const all = rowsWithState();
  const map = new Map();
  const order = [];
  for (const row of all) {
    const fam = familyOf(row.sku) || row.sku;
    const product = familyOf(row.sku) || row.product;
    if (!map.has(fam)) {
      map.set(fam, { key: fam, product, category: row.category, children: [] });
      order.push(fam);
    }
    map.get(fam).children.push(row);
  }
  return order.map((k) => map.get(k));
}

function statusOf(total, reorder) {
  if (total < reorder) return "Low";
  if (total <= reorder * 1.25) return "Watch";
  return "Healthy";
}

function statusClass(s) {
  return s === "Low" ? "low" : s === "Watch" ? "watch" : "ok";
}

function worstStatus(children) {
  if (children.some((c) => c.status === "Low")) return "Low";
  if (children.some((c) => c.status === "Watch")) return "Watch";
  return "Healthy";
}

function applyFilter(row) {
  const { q, channel } = filterState;
  const matches =
    !q ||
    row.sku.toLowerCase().includes(q) ||
    row.product.toLowerCase().includes(q) ||
    row.variant.toLowerCase().includes(q) ||
    row.category.toLowerCase().includes(q);
  let matchesCh = true;
  const a = row.amazon > 0, sh = row.shopify > 0;
  if (channel === "amazon") matchesCh = a;
  else if (channel === "shopify") matchesCh = sh;
  else if (channel === "both") matchesCh = a && sh;
  return matches && matchesCh;
}

// Build per-variant breakdown subtitle for the parent row.
// Compression Socks → group by version code (KHC/KHO/THC/THO).
// Other multi-variant products → list each child by its size suffix.
function breakdownText(group) {
  if (group.product === "Compression Socks") {
    const byVersion = new Map();
    for (const c of group.children) {
      const m = c.sku.match(/^CS-(\w+)-S/);
      const code = m ? m[1] : "?";
      byVersion.set(code, (byVersion.get(code) || 0) + c.total);
    }
    return [...byVersion.entries()]
      .map(([code, qty]) => `${code} ${fmtNumber(qty)}`)
      .join(" · ");
  }
  // Default: short variant label for each child SKU
  return group.children
    .map((c) => `${shortVariantLabel(c)} ${fmtNumber(c.total)}`)
    .join(" · ");
}

function shortVariantLabel(row) {
  // Strip off the product family prefix from the SKU for a compact label.
  // CWD-2X2 → "2x2"; SFD-4X4 → "4x4"; CWD-PWD → "Powder"; otherwise SKU.
  if (row.sku === "CWD-PWD") return "Powder";
  const m = row.sku.match(/^(?:CWD|SFD)-(\d+X\d+)$/);
  if (m) return m[1].toLowerCase().replace("x", "×");
  return row.sku;
}

// ─── Hero / KPIs ────────────────────────────────────────────────────

function renderHero() {
  const all = rowsWithState();
  const totalUnits = all.reduce((s, r) => s + r.total, 0);
  const lowCount = all.filter((r) => r.status === "Low").length;
  const watchCount = all.filter((r) => r.status === "Watch").length;
  const healthy = all.length - lowCount - watchCount;

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
    { label: "Low Stock", value: fmtNumber(totals.low) },
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

// ─── Table ──────────────────────────────────────────────────────────

function renderTable() {
  const groups = buildGroups();
  const all = groups.flatMap((g) => g.children);
  const body = panelEl.querySelector("#invBody");

  // If the user is searching, auto-expand any group with matching children.
  if (filterState.q) {
    for (const g of groups) {
      if (g.children.some(applyFilter)) expanded.add(g.key);
    }
  }

  let visibleCount = 0;
  let html = "";

  for (const group of groups) {
    const matchedChildren = group.children.filter(applyFilter);
    if (matchedChildren.length === 0) continue;
    const isMulti = group.children.length > 1;

    if (!isMulti) {
      // Plain SKU row — no group header.
      const r = matchedChildren[0];
      html += renderLeafRow(r);
      visibleCount += 1;
      continue;
    }

    const isOpen = expanded.has(group.key);
    const aggAmazon = group.children.reduce((s, c) => s + c.amazon, 0);
    const aggShopify = group.children.reduce((s, c) => s + c.shopify, 0);
    const aggTotal = aggAmazon + aggShopify;
    const status = worstStatus(group.children);
    const breakdown = breakdownText(group);
    const variantCount = group.children.length;

    html += `
      <tr class="group-row${isOpen ? " is-open" : ""}" data-group="${escapeAttr(group.key)}">
        <td colspan="3" class="group-cell">
          <button class="group-toggle" type="button" aria-expanded="${isOpen ? "true" : "false"}">
            <svg class="chev" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="group-name">${escapeHtml(group.product)}</span>
            <span class="group-meta">${variantCount} variants</span>
          </button>
          <div class="group-summary">${breakdown}</div>
        </td>
        <td class="num ink"><strong>${fmtNumber(aggAmazon)}</strong></td>
        <td class="num ink"><strong>${fmtNumber(aggShopify)}</strong></td>
        <td class="num ink"><strong>${fmtNumber(aggTotal)}</strong></td>
        <td class="num muted">—</td>
        <td><span class="status ${statusClass(status)}">${status}</span></td>
      </tr>
    `;
    visibleCount += 1;

    if (isOpen) {
      for (const r of matchedChildren) {
        html += renderLeafRow(r, /* indented */ true);
      }
      visibleCount += matchedChildren.length;
    }
  }

  if (!visibleCount) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty">No SKUs match your filters.</div></td></tr>`;
  } else {
    body.innerHTML = html;
  }

  panelEl.querySelector("#invCount").textContent =
    `${all.filter(applyFilter).length} of ${all.length} SKUs`;

  // Wire row-level handlers (toggles + inputs).
  body.querySelectorAll(".group-row").forEach((tr) => {
    tr.querySelector(".group-toggle").addEventListener("click", () => {
      const key = tr.dataset.group;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      renderTable();
    });
  });

  body.querySelectorAll("input[type='number']").forEach((input) => {
    input.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");
      updateRow(tr.dataset.sku, { [e.target.dataset.field]: e.target.value });
    });
  });
}

function renderLeafRow(r, indented = false) {
  return `
    <tr class="${r.status === "Low" ? "row-low" : ""}${indented ? " is-child" : ""}" data-sku="${r.sku}">
      <td><span class="sku-cell">${r.sku}</span></td>
      <td class="ink">${escapeHtml(r.product)}</td>
      <td class="muted">${escapeHtml(r.variant)}</td>
      <td class="num"><input type="number" min="0" data-field="amazon" value="${r.amazon}" /></td>
      <td class="num"><input type="number" min="0" data-field="shopify" value="${r.shopify}" /></td>
      <td class="num ink"><strong>${fmtNumber(r.total)}</strong></td>
      <td class="num"><input type="number" min="0" data-field="reorderLevel" value="${r.reorderLevel}" /></td>
      <td><span class="status ${statusClass(r.status)}">${r.status}</span></td>
    </tr>`;
}

// ─── Export ─────────────────────────────────────────────────────────

function exportCsv() {
  const all = rowsWithState();
  const rows = all.filter(applyFilter);
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
function escapeAttr(s) { return escapeHtml(s); }
