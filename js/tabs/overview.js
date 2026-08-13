// Overview — an editable dashboard assembled from widgets.
//
// Was a fixed page; now the team picks what appears. Two cautions still
// hold and are stated on the page rather than left implicit:
//
//   1. Amazon reports "ordered product sales" (before refunds and before
//      Amazon's fees); Shopify reports net of refunds. Not the same
//      measure, so the combined figure is an upper bound.
//   2. No blended ROAS. Meta and Google cannot observe Amazon purchases,
//      so a combined ROAS would be fiction. TACOS holds regardless of who
//      gets attribution credit.
//
// The layout lives in Supabase, shared across the team — see migration
// 0014 for why it is shared rather than per-browser.

import {
  fetchSales, fetchAds, fetchShopSales, fetchShopTotals, fetchSyncStatus, fetchFbaInventory,
  salesTotals, salesBySku, adTotals, adMetrics, shopTotals, shopByProduct,
  daysAvailable, PLATFORM_LABELS, DATA_START,
} from "../data/live.js";
import { bucketSeries, isPartialBucket } from "../series.js";
import { seedInventory, skuMap } from "../data/inventory.js";
import { getState, subscribe } from "../state.js";
import { supabase } from "../supabase.js";
import { exportButton, wireExport } from "../export.js";
import { fmtCurrency, fmtNumber, fmtPercent } from "../format.js";
import {
  escapeHtml, debounce, periodButtons, wirePeriod, periodLabel, floorNote,
  grainButtons, wireGrain, loadingBox, errorBox, emptyBox, NO_SYNC_HINT,
  syncStateFor, syncBadge, syncLine,
} from "../ui.js";
import { WIDGETS, WIDGET_MAP, GROUPS, DEFAULT_LAYOUT } from "../widgets.js";

let panelEl = null;
let period = "all";
let grain = "day";
let layout = null;          // array of widget ids; null until loaded
let editing = false;
let ctx = null;
let picking = false;

const LAYOUT_ID = "overview";

// ─── Layout persistence ──────────────────────────────────────────────

async function loadLayout() {
  const { data, error } = await supabase
    .from("dashboard_layout").select("widgets").eq("id", LAYOUT_ID).maybeSingle();
  if (error || !data) return [...DEFAULT_LAYOUT];
  const saved = Array.isArray(data.widgets) ? data.widgets : [];
  // Drop ids that no longer exist so a removed widget can't wedge the page.
  const clean = saved.filter((id) => WIDGET_MAP.has(id));
  return clean.length ? clean : [...DEFAULT_LAYOUT];
}

async function saveLayout() {
  const { error } = await supabase
    .from("dashboard_layout")
    .upsert([{ id: LAYOUT_ID, widgets: layout }], { onConflict: "id" });
  const note = panelEl?.querySelector("#ovSaveNote");
  if (note) {
    note.textContent = error ? `Couldn't save: ${error.message}` : "Layout saved";
    note.className = error ? "hint bad" : "hint";
    setTimeout(() => { if (note) note.textContent = ""; }, 2500);
  }
}

// ─── Mount ───────────────────────────────────────────────────────────

export function mountOverview(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Overview <span id="ovBadge"></span></h2>
        <p>Every channel together — revenue, advertising, and what it costs to grow.</p>
        ${floorNote(DATA_START)}
        <div id="ovSync"></div>
      </div>
      <div class="tab-tools">
        <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
        <div id="ovGrain"></div>
        ${exportButton("ovExport")}
        <button type="button" class="btn" id="ovEdit">Edit dashboard</button>
      </div>
    </div>
    <div id="ovEditBar"></div>
    <div id="ovBody">${loadingBox()}</div>
  `;

  panelEl.querySelector("#ovGrain").innerHTML = grainButtons(grain, daysAvailable());
  wirePeriod(el, () => period, (v) => { period = v; }, render);
  wireGrain(el, () => grain, (v) => { grain = v; }, render);
  wireExport(el, "ovExport", () => ctx?.exportData);

  el.querySelector("#ovEdit").addEventListener("click", () => {
    editing = !editing;
    picking = false;
    paint();
  });

  // Inventory edits elsewhere change cost widgets here.
  subscribe(debounce(() => { if (panelEl && ctx) { rebuildInventory(); paint(); } }, 200));

  render();
  window.addEventListener("resize", debounce(() => drawAll(), 150));
}

// ─── Data ────────────────────────────────────────────────────────────

async function render() {
  const body = panelEl.querySelector("#ovBody");
  body.innerHTML = loadingBox();

  const [amz, shop, shopSales, ads, runs, fba, savedLayout] = await Promise.all([
    fetchSales(period), fetchShopTotals(period), fetchShopSales(period),
    fetchAds(period), fetchSyncStatus(), fetchFbaInventory(),
    layout ? Promise.resolve(layout) : loadLayout(),
  ]);
  layout = savedLayout;

  const sync = syncStateFor(runs.rows, "catchr");
  panelEl.querySelector("#ovBadge").innerHTML = syncBadge(sync);
  panelEl.querySelector("#ovSync").innerHTML = syncLine(sync, "Catchr sync");

  if (amz.error && shop.error) {
    body.innerHTML = errorBox(amz.error, "Check that migrations 0004 and 0005 have been run in Supabase.");
    return;
  }
  if (!amz.rows.length && !shop.rows.length && !ads.rows.length) {
    body.innerHTML = emptyBox("No data in this window.", NO_SYNC_HINT);
    return;
  }

  const amzT = salesTotals(amz.rows);
  const shopT = shopTotals(shop.rows);
  const adT = adTotals(ads.rows);
  const revenue = amzT.revenue + shopT.net;
  const adM = adMetrics(adT, revenue);
  const bySku = salesBySku(amz.rows);
  const byProduct = shopByProduct(shopSales.rows);

  // Spend per platform
  const byPlatform = new Map();
  for (const r of ads.rows) {
    if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, []);
    byPlatform.get(r.platform).push(r);
  }
  const spendByPlatform = [...byPlatform.entries()].map(([p, rows]) => ({
    platform: p, label: PLATFORM_LABELS[p] || p, ...adTotals(rows),
  })).sort((a, b) => b.cost - a.cost);

  // Campaign roll-up — "what drove sales"
  const campMap = new Map();
  for (const r of ads.rows) {
    const key = `${r.platform}|${r.campaign_name || "(unnamed)"}`;
    const s = campMap.get(key) || {
      platform: r.platform, campaign: r.campaign_name || "(unnamed)",
      cost: 0, sales: 0, orders: 0, clicks: 0,
    };
    s.cost += Number(r.cost) || 0;
    s.sales += Number(r.attributed_sales) || 0;
    s.orders += Number(r.attributed_orders) || 0;
    s.clicks += Number(r.clicks) || 0;
    campMap.set(key, s);
  }
  const campaigns = [...campMap.values()].sort((a, b) => b.cost - a.cost);

  // Ad attribution for the sales log, keyed by DAY AND PRODUCT CATEGORY.
  //
  // Keying on day alone was wrong: it put "Hydro Roll | Auto" next to a
  // compression sock sale, implying a link that cannot exist. Every campaign
  // names its product line, so the category it targets can be read off the
  // name and matched to the SKU's own category.
  //
  // Order matters — "Sock Aid" must be tested before "sock", or the sock aid
  // would swallow every compression sock campaign.
  const campaignCategory = (name) => {
    const n = String(name || "").toLowerCase();
    if (/sock aid/.test(n)) return "Mobility";
    if (/hydro/.test(n)) return "Hydrocolloid";
    if (/compression|sock/.test(n)) return "Compression";
    if (/wound care|collagen|dressing/.test(n)) return "Wound Care";
    return null;
  };

  const driversByDayCat = new Map();
  for (const r of ads.rows) {
    const sales = Number(r.attributed_sales) || 0;
    if (sales <= 0) continue;
    const cat = campaignCategory(r.campaign_name);
    if (!cat) continue;
    const key = `${r.date}|${cat}`;
    const list = driversByDayCat.get(key) || [];
    list.push({ campaign: r.campaign_name || "(unnamed)", sales, platform: r.platform });
    driversByDayCat.set(key, list);
  }
  for (const list of driversByDayCat.values()) list.sort((a, b) => b.sales - a.sales);

  // Per SKU-day sales log, newest first
  const salesLog = amz.rows
    .filter((r) => (r.units_ordered || 0) > 0)
    .map((r) => {
      const sku = r.sku || r.amazon_sku;
      const meta = skuMap.get(sku);
      const cat = meta?.category || null;
      return {
        date: r.date, sku,
        product: meta?.product || r.title || sku,
        variant: meta?.variant || "",
        category: cat,
        units: r.units_ordered || 0,
        // Amazon gives no customer identifier, so this is order lines, not
        // unique buyers. Named accordingly everywhere it surfaces.
        orderItems: r.order_items || 0,
        revenue: Number(r.ordered_sales) || 0,
        drivers: cat ? (driversByDayCat.get(`${r.date}|${cat}`) || []).slice(0, 3) : [],
      };
    })
    .sort((a, b) => (a.date === b.date ? b.revenue - a.revenue : a.date < b.date ? 1 : -1));

  // Daily blended series
  const todayIso = new Date().toISOString().slice(0, 10);
  const merged = new Map();
  const fold = (rows, pick, keys) => {
    for (const b of bucketSeries(rows, grain, pick)) {
      const slot = merged.get(b.key) || { key: b.key, label: b.label };
      for (const k of keys) slot[k] = (slot[k] || 0) + (b[k] || 0);
      merged.set(b.key, slot);
    }
  };
  fold(amz.rows, (r) => ({ amazon: Number(r.ordered_sales) || 0 }), ["amazon"]);
  fold(shop.rows, (r) => ({ shopify: Number(r.net_sales) || 0 }), ["shopify"]);
  fold(ads.rows, (r) => ({ spend: Number(r.cost) || 0 }), ["spend"]);
  const daily = [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((d) => {
    const partial = isPartialBucket(d.key, grain, DATA_START, todayIso);
    const rev = (d.amazon || 0) + (d.shopify || 0);
    return { ...d, amazon: d.amazon || 0, shopify: d.shopify || 0, spend: d.spend || 0,
             revenue: rev, partial, tipLabel: partial ? `${d.label} (partial)` : d.label };
  });

  ctx = {
    period, grain, amz, shop, ads, runs, fba,
    amzT, shopT, adT, adM, revenue, bySku, byProduct,
    spendByPlatform, campaigns, salesLog, daily,
    available: daysAvailable(),
    exportData: {
      name: "overview", grain,
      rows: daily.map((d) => ({
        bucket: d.label, key: d.key, partial: d.partial ? "yes" : "",
        amazon: d.amazon.toFixed(2), shopify_net: d.shopify.toFixed(2),
        total_revenue: d.revenue.toFixed(2), ad_spend: d.spend.toFixed(2),
        tacos: d.revenue > 0 ? ((d.spend / d.revenue) * 100).toFixed(1) + "%" : "",
      })),
      columns: [
        { key: "bucket", label: grain }, { key: "key", label: "key" }, { key: "partial", label: "partial_bucket" },
        { key: "amazon", label: "amazon_ordered_sales" }, { key: "shopify_net", label: "shopify_net_sales" },
        { key: "total_revenue", label: "total_revenue" }, { key: "ad_spend", label: "ad_spend" }, { key: "tacos", label: "tacos" },
      ],
    },
  };
  rebuildInventory();
  paint();
}

// Inventory + unit-economics parts of ctx, refreshed whenever state changes.
function rebuildInventory() {
  const { inventory } = getState();
  const invRows = seedInventory.map((row) => {
    const s = inventory[row.sku] || {};
    const fbaQty = s.amazon || 0;
    const warehouse = s.warehouse || 0;
    return {
      sku: row.sku, product: row.product, variant: row.variant,
      retail: row.suggestedPrice || 0, reorderLevel: row.reorderLevel || 0,
      cogs: s.cogs || 0, amazonFee: s.amazonFee || 0, shipCost: s.shipCost || 0,
      fba: fbaQty, warehouse, total: fbaQty + warehouse,
    };
  });
  const invT = invRows.reduce((a, r) => {
    a.units += r.total; a.fba += r.fba; a.warehouse += r.warehouse;
    a.atCost += r.total * r.cogs;
    if (r.reorderLevel > 0) { a.tracked += 1; if (r.total === 0) a.oos += 1; }
    return a;
  }, { units: 0, fba: 0, warehouse: 0, atCost: 0, oos: 0, tracked: 0 });

  // Unit economics on what actually sold
  const costBySku = new Map(invRows.map((r) => [r.sku, r]));
  let fees = 0, cogs = 0, shipping = 0, uncosted = 0;
  for (const s of ctx.bySku) {
    const c = costBySku.get(s.sku);
    if (!c || (c.cogs === 0 && c.amazonFee === 0)) { uncosted += s.units; continue; }
    fees += s.units * c.amazonFee;
    cogs += s.units * c.cogs;
    shipping += s.units * c.shipCost;
  }
  const contribution = ctx.revenue - fees - cogs - shipping;
  ctx.invRows = invRows;
  ctx.invT = invT;
  ctx.pl = {
    fees, cogs, shipping, contribution, uncosted,
    adSpend: ctx.adT.cost, net: contribution - ctx.adT.cost,
  };
}

// ─── Painting ────────────────────────────────────────────────────────

function paint() {
  if (!ctx || !panelEl) return;
  paintEditBar();
  const body = panelEl.querySelector("#ovBody");

  const cards = layout.map((id, i) => {
    const w = WIDGET_MAP.get(id);
    if (!w) return "";
    let inner;
    try {
      inner = w.render(ctx);
    } catch (err) {
      inner = `<div class="card"><div class="card-body"><div class="empty">
        “${escapeHtml(w.title)}” failed to render: ${escapeHtml(err.message)}</div></div></div>`;
    }
    return `
      <div class="w w-${w.size}${editing ? " is-editing" : ""}" data-widget="${escapeHtml(id)}">
        ${editing ? `
          <div class="w-tools">
            <button type="button" class="w-btn" data-move="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button type="button" class="w-btn" data-move="down" data-i="${i}" ${i === layout.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            <button type="button" class="w-btn danger" data-remove="${escapeHtml(id)}" aria-label="Remove">×</button>
          </div>` : ""}
        ${inner}
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="insight">
      <div class="ico">i</div>
      <div class="body">
        Amazon reports <strong>ordered product sales</strong> — before refunds and before its referral
        and FBA fees. Shopify reports <strong>net of refunds</strong>. The combined figure mixes the two,
        so treat it as an upper bound. No blended ROAS is shown: Meta and Google can't observe Amazon
        purchases, so only <strong>TACOS</strong> is meaningful across channels.
      </div>
    </div>
    <div class="w-grid">${cards || `<div class="empty">No widgets. Click <strong>Edit dashboard</strong> to add some.</div>`}</div>
  `;

  body.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      layout = layout.filter((x) => x !== b.dataset.remove);
      void saveLayout(); paint();
    }));
  body.querySelectorAll("[data-move]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.i);
      const j = b.dataset.move === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= layout.length) return;
      [layout[i], layout[j]] = [layout[j], layout[i]];
      void saveLayout(); paint();
    }));

  drawAll();
}

function paintEditBar() {
  const bar = panelEl.querySelector("#ovEditBar");
  panelEl.querySelector("#ovEdit").textContent = editing ? "Done editing" : "Edit dashboard";
  if (!editing) { bar.innerHTML = ""; return; }

  const inUse = new Set(layout);
  bar.innerHTML = `
    <div class="edit-bar">
      <div class="edit-row">
        <strong>Editing</strong>
        <span class="hint">${layout.length} of ${WIDGETS.length} widgets shown · reorder with ↑ ↓ · × removes</span>
        <span class="spacer"></span>
        <span class="hint" id="ovSaveNote"></span>
        <button type="button" class="btn" id="ovAdd">${picking ? "Close" : "Add widget"}</button>
        <button type="button" class="btn" id="ovReset">Reset to default</button>
      </div>
      ${picking ? `
        <div class="picker">
          ${GROUPS.map((g) => {
            const items = WIDGETS.filter((w) => w.group === g);
            return `
              <div class="picker-group">
                <h4>${escapeHtml(g)}</h4>
                ${items.map((w) => `
                  <button type="button" class="pick${inUse.has(w.id) ? " is-in" : ""}"
                          data-add="${escapeHtml(w.id)}" ${inUse.has(w.id) ? "disabled" : ""}>
                    <span>${escapeHtml(w.title)}</span>
                    <span class="pick-size">${w.size}</span>
                  </button>`).join("")}
              </div>`;
          }).join("")}
        </div>` : ""}
    </div>`;

  bar.querySelector("#ovAdd").addEventListener("click", () => { picking = !picking; paintEditBar(); });
  bar.querySelector("#ovReset").addEventListener("click", () => {
    layout = [...DEFAULT_LAYOUT]; void saveLayout(); paint();
  });
  bar.querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", () => {
      layout = [...layout, b.dataset.add];
      void saveLayout(); picking = false; paint();
    }));
}

function drawAll() {
  if (!ctx || !panelEl) return;
  for (const id of layout) {
    const w = WIDGET_MAP.get(id);
    if (!w?.draw) continue;
    const host = panelEl.querySelector(`[data-widget="${CSS.escape(id)}"]`);
    if (host) { try { w.draw(host, ctx); } catch { /* a chart failing must not blank the page */ } }
  }
}
