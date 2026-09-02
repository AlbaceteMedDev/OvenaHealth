// Inventory tab — grouped catalog table with collapsible product families.
//
// The Amazon column has two modes. Once the SP-API sync has run, a listed
// SKU shows its real FBA fulfillable quantity (read-only, with inbound
// alongside). Until then — or for SKUs Amazon doesn't return — it falls back
// to the manually-edited number, so the existing workflow keeps working.

import { seedInventory, resolveSku } from "../data/inventory.js";
import { getState, updateRow, resetQuantities, subscribe } from "../state.js";
import { fetchFbaInventory, fetchSyncStatus, fetchAmzOrders } from "../data/live.js";
import { fmtNumber } from "../format.js";
import { openAmazonImport } from "../importer.js";
import { syncStateFor, syncBadge, syncLine } from "../ui.js";

let panelEl = null;
let filterState = { q: "", channel: "stocked" };
const expanded = new Set(); // group keys currently expanded

// SKU → { fulfillable, inbound, reserved, unfulfillable, soldSince, asOf }.
// Empty until fba_inventory has rows.
let fbaBySku = new Map();

export function mountInventory(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Inventory <span id="invBadge"></span></h2>
        <p>FBA stock from Amazon, warehouse stock from scans. Scan on the Scan tab, import Amazon reports here, or edit inline.</p>
        <div id="invSync"></div>
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
          <input type="search" id="invSearch" placeholder="Search SKU, ASIN, product, variant, category…" />
          <select id="invChannel">
            <option value="stocked">Currently stocked</option>
            <option value="all">All SKUs (incl. retired)</option>
            <option value="listed">Listed on Amazon</option>
            <option value="retired">Retired listings</option>
            <option value="low">Low stock</option>
          </select>
          <span style="flex:1"></span>
          <button class="btn ghost" id="invExpandAll">Expand all</button>
          <button class="btn ghost" id="invImport">Import Amazon report</button>
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
              <th class="num">Inbound</th>
              <th class="num">Warehouse</th>
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
      <span class="sock-key-title">Stocked on Amazon</span>
      <span class="sock-key-item"><b>HC-ROLL</b> Hydrocolloid Roll — 5 ft, 16 ft</span>
      <span class="sock-key-item"><b>CWD</b> Collagen Wound Dressing — 2×2, 4×4</span>
      <span class="sock-key-item"><b>CWD-PWD</b> Collagen Wound Powder — 1 g</span>
      <span class="sock-key-item"><b>CS-KHC</b> Compression Socks — M, L, XL</span>
      <span class="sock-key-item"><b>SOCK-AID</b> Sock Aid Device</span>
      <span class="sock-key-foot">9 stocked SKUs · sock S retired (still listed, kept for history)</span>
    </div>
  `;

  const channelSel = el.querySelector("#invChannel");
  if (![...channelSel.options].some((o) => o.value === filterState.channel)) {
    filterState.channel = "stocked";
  }
  channelSel.value = filterState.channel;
  el.querySelector("#invSearch").value = filterState.q;

  el.querySelector("#invSearch").addEventListener("input", (e) => {
    filterState.q = e.target.value;
    renderTable();
  });
  el.querySelector("#invChannel").addEventListener("change", (e) => {
    filterState.channel = e.target.value;
    renderTable();
  });
  el.querySelector("#invReset").addEventListener("click", () => {
    if (confirm("Reset every manual Amazon and Warehouse quantity to 0?\n\nLive FBA numbers are not affected — they come from Amazon.")) {
      resetQuantities();
    }
  });
  el.querySelector("#invImport").addEventListener("click", openAmazonImport);
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
  void loadFba();
}

// ─── Live FBA ────────────────────────────────────────────────────────

async function loadFba() {
  // Orders come along because they are what keeps the Amazon column moving:
  // fba_inventory is a snapshot, but amz_orders refreshes every 30 minutes,
  // so FBA units sold SINCE the snapshot can be subtracted from it. The
  // column then decays in near-real-time between snapshots instead of
  // freezing at whatever was true when the snapshot was taken.
  const [fba, runs, orders] = await Promise.all([
    fetchFbaInventory(),
    fetchSyncStatus(),
    fetchAmzOrders(14),
  ]);
  if (!panelEl) return;

  const sync = syncStateFor(runs.rows, "fba");
  panelEl.querySelector("#invBadge").innerHTML =
    sync.state === "off" ? "" : syncBadge({ ...sync, label: sync.state === "live" ? "FBA live" : sync.label });
  panelEl.querySelector("#invSync").innerHTML =
    sync.state === "off"
      ? `<div class="syncline">FBA stock isn't syncing yet — the Amazon column is manual. See <code>docs/SPAPI_SETUP.md</code>.</div>`
      : syncLine(sync, "FBA sync");

  if (fba.error) return;

  // FBA units sold after each SKU's snapshot day. Strictly AFTER: Amazon has
  // already removed the snapshot day's earlier sales from Available, so
  // subtracting that day again would double-count. Cancelled orders never
  // shipped; an orders fetch error just leaves the map empty and the raw
  // snapshot shows — stale beats wrong.
  const snapDay = new Map();
  for (const r of fba.rows) {
    const key = r.sku || r.amazon_sku;
    const day = (r.synced_at || "").slice(0, 10);
    if (!snapDay.has(key) || day < snapDay.get(key)) snapDay.set(key, day);
  }
  const soldSince = new Map();
  for (const o of orders.rows || []) {
    if (o.fulfillment_channel !== "Amazon") continue;
    if (o.order_status === "Cancelled") continue;
    const day = snapDay.get(o.sku);
    if (!day || o.purchase_day <= day) continue;
    // amz_orders carries the SELLER sku ("SOCK-AID-FBA"); the snapshot is
    // keyed on the catalog sku ("SOCK-AID"). Keyed on the raw value, nothing
    // ever matched and the decay silently never applied.
    const cat = resolveSku(o.sku, null)?.sku || o.sku;
    soldSince.set(cat, (soldSince.get(cat) || 0) + (o.quantity || 0));
  }

  const map = new Map();
  for (const r of fba.rows) {
    const key = r.sku || r.amazon_sku;
    const slot = map.get(key) || { fulfillable: 0, inbound: 0, reserved: 0, unfulfillable: 0, soldSince: 0, asOf: null };
    slot.fulfillable += r.fulfillable || 0;
    slot.inbound += (r.inbound_working || 0) + (r.inbound_shipped || 0) + (r.inbound_receiving || 0);
    slot.reserved += r.reserved || 0;
    slot.unfulfillable += r.unfulfillable || 0;
    slot.asOf = snapDay.get(key) || null;
    map.set(key, slot);
  }
  for (const [sku, sold] of soldSince) {
    const slot = map.get(sku);
    if (!slot) continue;
    slot.soldSince = sold;
    slot.fulfillable = Math.max(0, slot.fulfillable - sold);
  }
  fbaBySku = map;

  renderHero();
  renderKpis();
  renderTable();
}

// ─── Data shaping ────────────────────────────────────────────────────

function rowsWithState() {
  const { inventory } = getState();
  return seedInventory.map((row) => {
    const s = inventory[row.sku];
    const fba = fbaBySku.get(row.sku) || null;
    // Live FBA wins when we have it; otherwise fall back to the manual value.
    const amazon = fba ? fba.fulfillable : s.amazon;
    const inbound = fba ? fba.inbound : 0;
    const total = amazon + s.warehouse;
    return {
      ...row,
      amazon,
      inbound,
      isLiveFba: Boolean(fba),
      fbaSoldSince: fba ? fba.soldSince : 0,
      fbaAsOf: fba ? fba.asOf : null,
      warehouse: s.warehouse,
      reorderLevel: s.reorderLevel,
      total,
      stocked: row.stocked !== false,
      status: row.stocked === false ? "Retired" : statusOf(total, s.reorderLevel),
    };
  });
}

// Family lookup based on SKU prefix. Multi-variant SKU families fold into
// one collapsible group; singleton SKUs render as plain rows.
function familyOf(sku) {
  if (sku.startsWith("CWD-")) return "Collagen Wound Dressing";
  if (sku.startsWith("SFD-")) return "Silicone Foam Dressing";
  if (sku.startsWith("CS-")) return "Compression Socks";
  if (sku.startsWith("HC-ROLL")) return "Hydrocolloid Roll";
  return null;
}

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
  if (s === "Retired") return "";
  return s === "Low" ? "low" : s === "Watch" ? "watch" : "ok";
}

function worstStatus(children) {
  if (children.some((c) => c.status === "Low")) return "Low";
  if (children.some((c) => c.status === "Watch")) return "Watch";
  return "Healthy";
}

function applyFilter(row) {
  const q = filterState.q.trim().toLowerCase();
  const { channel } = filterState;
  const matches =
    !q ||
    row.sku.toLowerCase().includes(q) ||
    (row.asin || "").toLowerCase().includes(q) ||
    row.product.toLowerCase().includes(q) ||
    row.variant.toLowerCase().includes(q) ||
    row.category.toLowerCase().includes(q);

  let matchesCh = true;
  if (channel === "stocked") matchesCh = row.stocked !== false;
  else if (channel === "listed") matchesCh = row.listed;
  else if (channel === "retired") matchesCh = row.listed && row.stocked === false;
  else if (channel === "low") matchesCh = row.status === "Low";
  return matches && matchesCh;
}

// Per-variant breakdown subtitle for the parent row.
function breakdownText(children) {
  return children
    .map((c) => `${shortVariantLabel(c)} ${fmtNumber(c.total)}`)
    .join(" · ");
}

function shortVariantLabel(row) {
  if (row.sku === "CWD-PWD") return "Powder";
  const wound = row.sku.match(/^(?:CWD|SFD)-(\d+X\d+)$/);
  if (wound) return wound[1].toLowerCase().replace("x", "×");
  const sock = row.sku.match(/^CS-KHC-(S|M|L|XL)-BLK$/);
  if (sock) return sock[1];
  const roll = row.sku.match(/^HC-ROLL(\d+)FT$/);
  if (roll) return `${roll[1]} ft`;
  return row.sku;
}

// ─── Hero / KPIs ────────────────────────────────────────────────────

function renderHero() {
  const all = rowsWithState().filter((r) => r.stocked);
  const totalUnits = all.reduce((s, r) => s + r.total, 0);
  const lowCount = all.filter((r) => r.status === "Low").length;
  const watchCount = all.filter((r) => r.status === "Watch").length;
  const healthy = all.length - lowCount - watchCount;
  const inbound = all.reduce((s, r) => s + r.inbound, 0);

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
    <div class="sub">${all.length} SKUs tracked · ${healthy} healthy · ${watchCount} on watch · ${lowCount} low${inbound > 0 ? ` · ${fmtNumber(inbound)} inbound to Amazon` : ""}</div>
  `;
}

function renderKpis() {
  const all = rowsWithState().filter((r) => r.stocked);
  const totals = all.reduce(
    (acc, r) => {
      acc.amazon += r.amazon;
      acc.inbound += r.inbound;
      acc.warehouse += r.warehouse;
      if (r.status === "Low") acc.low++;
      if (r.status === "Watch") acc.watch++;
      return acc;
    },
    { amazon: 0, inbound: 0, warehouse: 0, low: 0, watch: 0 },
  );
  const cards = [
    { label: "Amazon (FBA)", value: fmtNumber(totals.amazon) },
    { label: "Inbound", value: fmtNumber(totals.inbound) },
    { label: "Warehouse Units", value: fmtNumber(totals.warehouse) },
    { label: "Low Stock", value: fmtNumber(totals.low) },
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
    const isMulti = matchedChildren.length > 1;

    if (!isMulti) {
      html += renderLeafRow(matchedChildren[0]);
      visibleCount += 1;
      continue;
    }

    const isOpen = expanded.has(group.key);
    const aggAmazon = matchedChildren.reduce((s, c) => s + c.amazon, 0);
    const aggInbound = matchedChildren.reduce((s, c) => s + c.inbound, 0);
    const aggWarehouse = matchedChildren.reduce((s, c) => s + c.warehouse, 0);
    const aggTotal = aggAmazon + aggWarehouse;
    const status = worstStatus(matchedChildren);

    html += `
      <tr class="group-row${isOpen ? " is-open" : ""}" data-group="${escapeAttr(group.key)}">
        <td colspan="3" class="group-cell">
          <button class="group-toggle" type="button" aria-expanded="${isOpen ? "true" : "false"}">
            <svg class="chev" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="group-name">${escapeHtml(group.product)}</span>
            <span class="group-meta">${matchedChildren.length} variants</span>
          </button>
          <div class="group-summary">${breakdownText(matchedChildren)}</div>
        </td>
        <td class="num ink"><strong>${fmtNumber(aggAmazon)}</strong></td>
        <td class="num muted">${aggInbound > 0 ? fmtNumber(aggInbound) : "—"}</td>
        <td class="num ink"><strong>${fmtNumber(aggWarehouse)}</strong></td>
        <td class="num ink"><strong>${fmtNumber(aggTotal)}</strong></td>
        <td class="num muted">—</td>
        <td><span class="status ${statusClass(status)}">${status}</span></td>
      </tr>
    `;
    visibleCount += 1;

    if (isOpen) {
      for (const r of matchedChildren) html += renderLeafRow(r, true);
      visibleCount += matchedChildren.length;
    }
  }

  if (visibleCount) {
    body.innerHTML = html;
  } else {
    const channelLabel =
      panelEl.querySelector(`#invChannel option[value="${filterState.channel}"]`)?.textContent ||
      filterState.channel;
    const why = [
      filterState.channel !== "stocked" ? `channel “${channelLabel}”` : null,
      filterState.q.trim() ? `search “${escapeHtml(filterState.q.trim())}”` : null,
    ].filter(Boolean).join(" and ");
    body.innerHTML = `<tr><td colspan="9"><div class="empty">
      No SKUs match ${why || "your filters"}.
      <button type="button" class="btn ghost" id="invClearFilters" style="margin-left:10px">Show everything</button>
    </div></td></tr>`;
    body.querySelector("#invClearFilters").addEventListener("click", () => {
      filterState = { q: "", channel: "stocked" };
      panelEl.querySelector("#invChannel").value = "stocked";
      panelEl.querySelector("#invSearch").value = "";
      renderTable();
    });
  }

  panelEl.querySelector("#invCount").textContent =
    `${all.filter(applyFilter).length} of ${all.length} SKUs`;

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
  // Live FBA is read-only — editing it would be a lie, Amazon owns the number.
  const fbaNote = r.fbaSoldSince
    ? `FBA snapshot ${r.fbaAsOf || ""} minus ${r.fbaSoldSince} sold since (orders refresh every 30 min)`
    : `FBA snapshot ${r.fbaAsOf || ""}`;
  const amazonCell = r.isLiveFba
    ? `<td class="num ink" title="${escapeAttr(fbaNote)}"><strong>${fmtNumber(r.amazon)}</strong></td>`
    : `<td class="num"><input type="number" min="0" data-field="amazon" value="${r.amazon}" /></td>`;

  return `
    <tr class="${r.status === "Low" ? "row-low" : ""}${indented ? " is-child" : ""}" data-sku="${r.sku}">
      <td><span class="sku-cell">${r.sku}</span>${r.listed ? "" : ` <span class="chip">unlisted</span>`}</td>
      <td class="ink">${escapeHtml(r.product)}</td>
      <td class="muted">${escapeHtml(r.variant)}</td>
      ${amazonCell}
      <td class="num muted">${r.inbound > 0 ? fmtNumber(r.inbound) : "—"}</td>
      <td class="num"><input type="number" min="0" data-field="warehouse" value="${r.warehouse}" /></td>
      <td class="num ink"><strong>${fmtNumber(r.total)}</strong></td>
      <td class="num"><input type="number" min="0" data-field="reorderLevel" value="${r.reorderLevel}" /></td>
      <td><span class="status ${statusClass(r.status)}">${r.status}</span></td>
    </tr>`;
}

// ─── Export ─────────────────────────────────────────────────────────

function exportCsv() {
  const rows = rowsWithState().filter(applyFilter);
  const header = ["SKU", "ASIN", "Product", "Category", "Variant", "Listed", "Amazon", "Amazon source", "Inbound", "Warehouse", "Total", "Reorder", "Status"];
  const lines = [header, ...rows.map((r) => [
    r.sku, r.asin || "", r.product, r.category, r.variant, r.listed ? "yes" : "no",
    r.amazon, r.isLiveFba ? "FBA live" : "manual", r.inbound, r.warehouse, r.total, r.reorderLevel, r.status,
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
