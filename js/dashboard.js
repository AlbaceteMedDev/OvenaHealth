// A dashboard is a scoped, editable grid of widgets.
//
// Overview and each channel tab are the same machine with different scopes:
// which widgets may be placed, which advertising platform counts, and which
// row in dashboard_layout the arrangement is saved to. Overview is the only
// scope that sees every group — a channel tab offers only its own widgets,
// so an Amazon dashboard cannot quietly start reporting Meta's numbers.
//
// cfg:
//   layoutId       row key in dashboard_layout — unique per tab
//   prefix         element-id prefix, so several dashboards can coexist
//   title/subtitle tab header
//   groups         widget groups this scope may place
//   defaultLayout  widget ids shown before anyone customises
//   platform       ad platform to filter to, or null for all of them

import {
  fetchSales, fetchAds, fetchShopSales, fetchShopTotals, fetchSyncStatus, fetchFbaInventory,
  fetchSeoSessions, fetchAdsBySku, fetchStoreCosts, fetchTraffic, fetchAmzOrders,
  fetchSeoQueries, fetchSeoPages, rollupSearch,
  salesTotals, salesBySku, adTotals, adMetrics, shopTotals, shopByProduct,
  daysAvailable, PLATFORM_LABELS, DATA_START,
} from "./data/live.js";
import { bucketSeries, isPartialBucket } from "./series.js";
import { seedInventory, skuMap, resolveShopifySku } from "./data/inventory.js";
import { getState, subscribe } from "./state.js";
import { supabase } from "./supabase.js";
import { exportButton, wireExport } from "./export.js";
import { fmtCurrency, fmtNumber, fmtPercent } from "./format.js";
import {
  escapeHtml, debounce, periodButtons, wirePeriod, periodLabel, floorNote,
  grainButtons, wireGrain, loadingBox, errorBox, emptyBox, NO_SYNC_HINT,
  syncStateFor, syncBadge, syncLine,
} from "./ui.js";
import { WIDGETS, WIDGET_MAP } from "./widgets.js";

const COLS = 12;

// Column spans offered in edit mode, out of a 12-column grid.
export const SPANS = [
  { w: 3, label: "¼" },
  { w: 4, label: "⅓" },
  { w: 6, label: "½" },
  { w: 8, label: "⅔" },
  { w: 12, label: "Full" },
];

export function makeDashboard(cfg) {
  const P = cfg.prefix;
  const CATALOG = WIDGETS.filter((w) => cfg.groups.includes(w.group));
  const CATALOG_GROUPS = [...new Set(CATALOG.map((w) => w.group))];

let panelEl = null;
let wiredResize = false;
let period = "all";
let grain = "day";
let layout = null;          // array of widget ids; null until loaded
let editing = false;
let ctx = null;
let picking = false;
const selected = new Set();   // widget ids ticked in the picker, pre-add

const LAYOUT_ID = cfg.layoutId;

const COLS = 12;

// Column spans offered in edit mode, out of a 12-column grid.


// Widths a widget's content actually works at. A KPI tile stretched to full
// width is a lot of whitespace around one number; a six-column table squeezed
// into a quarter is a scrollbar. Widgets declare what suits them.
const allowedSpans = (id) => WIDGET_MAP.get(id)?.spans ?? SPANS.map((s) => s.w);

// A widget's natural width when it has never been resized.
const defaultSpan = (id) => {
  const natural = { kpi: 3, half: 6, full: 12 }[WIDGET_MAP.get(id)?.size] ?? 6;
  const ok = allowedSpans(id);
  return ok.includes(natural) ? natural : ok[ok.length - 1];
};

// ─── Layout persistence ──────────────────────────────────────────────
//
// Stored as [{ id, w }]. Older layouts were a bare array of ids, so those
// are upgraded on read rather than discarded — a saved dashboard should
// survive the feature that added resizing.

// Layout items are { id, w, x, y }: a column span plus an explicit cell on a
// 12-column grid. x/y are what let a widget sit anywhere — including with a
// gap beside it — rather than being packed against its neighbour.
//
// Items saved before placement existed have no x/y. Rather than discard them,
// autoFlow lays them out exactly the way the packing grid used to, so an
// existing dashboard opens looking identical and only moves when dragged.
function autoFlow(items) {
  let x = 0, y = 0;
  for (const it of items) {
    if (Number.isInteger(it.x) && Number.isInteger(it.y)) continue;
    if (x + it.w > COLS) { x = 0; y += 1; }
    it.x = x; it.y = y;
    x += it.w;
    if (x >= COLS) { x = 0; y += 1; }
  }
  return items;
}

// Ids this scope is allowed to place. A saved layout is filtered against
// THIS, not the global widget map — otherwise a layout saved while a group
// still belonged to the tab keeps rendering those widgets after the group
// moves away, which is the scope leak the tab split is meant to prevent.
// SEO left the Shopify tab this way and its widgets stayed on saved
// dashboards until this filter existed.
const CATALOG_IDS = new Set(CATALOG.map((w) => w.id));

function normalize(saved) {
  if (!Array.isArray(saved)) return null;
  const out = [];
  for (const entry of saved) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!WIDGET_MAP.has(id)) continue;          // widget removed from the catalogue
    if (!CATALOG_IDS.has(id)) continue;         // widget not in THIS tab's scope
    const raw = typeof entry === "object" ? Number(entry.w) : NaN;
    const w = allowedSpans(id).includes(raw) ? raw : defaultSpan(id);
    const xr = Number(entry?.x), yr = Number(entry?.y);
    const x = Number.isInteger(xr) ? Math.max(0, Math.min(COLS - w, xr)) : null;
    const y = Number.isInteger(yr) && yr >= 0 ? yr : null;
    out.push({ id, w, x, y });
  }
  return out.length ? autoFlow(out) : null;
}

const defaultLayout = () =>
  autoFlow(cfg.defaultLayout.map((id) => ({ id, w: defaultSpan(id), x: null, y: null })));

async function loadLayout() {
  const { data, error } = await supabase
    .from("dashboard_layout").select("widgets").eq("id", LAYOUT_ID).maybeSingle();
  if (error || !data) return defaultLayout();
  return normalize(data.widgets) || defaultLayout();
}

async function saveLayout() {
  const { error } = await supabase
    .from("dashboard_layout")
    .upsert([{ id: LAYOUT_ID, widgets: layout }], { onConflict: "id" });
  const note = panelEl?.querySelector(`#${P}SaveNote`);
  if (note) {
    note.textContent = error ? `Couldn't save: ${error.message}` : "Layout saved";
    note.className = error ? "hint bad" : "hint";
    setTimeout(() => { if (note) note.textContent = ""; }, 2500);
  }
}

// ─── Mount ───────────────────────────────────────────────────────────

  function mount(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>${escapeHtml(cfg.title)} <span id="${P}Badge"></span></h2>
        <p>${escapeHtml(cfg.subtitle)}</p>
        ${floorNote(DATA_START)}
        <div id="${P}Sync"></div>
      </div>
      <div class="tab-tools">
        <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
        <div id="${P}Grain"></div>
        ${exportButton(`${P}Export`)}
        <button type="button" class="btn" id="${P}Edit">Edit dashboard</button>
      </div>
    </div>
    <div id="${P}EditBar"></div>
    <div id="${P}Body">${loadingBox()}</div>
  `;

  panelEl.querySelector(`#${P}Grain`).innerHTML = grainButtons(grain, daysAvailable());
  wirePeriod(el, () => period, (v) => { period = v; }, render);
  wireGrain(el, () => grain, (v) => { grain = v; }, render);
  wireExport(el, `${P}Export`, () => ctx?.exportData);

  el.querySelector(`#${P}Edit`).addEventListener("click", () => {
    editing = !editing;
    picking = false;
    paint();
  });

  // Inventory edits elsewhere change cost widgets here.
  subscribe(debounce(() => { if (panelEl && ctx) { rebuildInventory(); paint(); } }, 200));

  render();
  // Guarded: auto-refresh re-mounts the tab, and an unguarded
    // registration would stack a new listener on every refresh.
    if (!wiredResize) {
      wiredResize = true;
      window.addEventListener("resize", debounce(() => drawAll(), 150));
    }
}

// ─── Data ────────────────────────────────────────────────────────────

async function render() {
  const body = panelEl.querySelector(`#${P}Body`);
  body.innerHTML = loadingBox();

  const [amz, shop, shopSales, ads, runs, fba, seoRows, adsBySku, storeCostRows, traffic, amzOrders,
         seoQueryRows, seoPageRows, savedLayout] = await Promise.all([
    fetchSales(period), fetchShopTotals(period), fetchShopSales(period),
    fetchAds(period), fetchSyncStatus(), fetchFbaInventory(),
    fetchSeoSessions(period),
    fetchAdsBySku(period),
    fetchStoreCosts(),
    fetchTraffic(period),
    fetchAmzOrders(period),
    fetchSeoQueries(period),
    fetchSeoPages(period),
    layout ? Promise.resolve(layout) : loadLayout(),
  ]);
  layout = savedLayout;

  const sync = syncStateFor(runs.rows, "catchr");
  panelEl.querySelector(`#${P}Badge`).innerHTML = syncBadge(sync);
  panelEl.querySelector(`#${P}Sync`).innerHTML = syncLine(sync, "Catchr sync");

  if (amz.error && shop.error) {
    body.innerHTML = errorBox(amz.error, "Check that migrations 0004 and 0005 have been run in Supabase.");
    return;
  }
  if (!amz.rows.length && !shop.rows.length && !ads.rows.length) {
    body.innerHTML = emptyBox("No data in this window.", NO_SYNC_HINT);
    return;
  }

  const amzT = salesTotals(amz.rows, traffic.rows);
  const shopT = shopTotals(shop.rows);
  // A scoped dashboard must not report account-wide advertising: Meta's ACOS
  // is not Amazon's. Everything downstream reads adRows, never ads.rows.
  const adRows = cfg.platform ? ads.rows.filter((r) => r.platform === cfg.platform) : ads.rows;
  const adT = adTotals(adRows);
  const revenue = amzT.revenue + shopT.net;
  const adM = adMetrics(adT, revenue);
  const bySku = salesBySku(amz.rows);
  const byProduct = shopByProduct(shopSales.rows);

  // Spend per platform
  const byPlatform = new Map();
  for (const r of adRows) {
    if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, []);
    byPlatform.get(r.platform).push(r);
  }
  const spendByPlatform = [...byPlatform.entries()].map(([p, rows]) => ({
    platform: p, label: PLATFORM_LABELS[p] || p, ...adTotals(rows),
  })).sort((a, b) => b.cost - a.cost);

  // Campaign roll-up — "what drove sales"
  const campMap = new Map();
  for (const r of adRows) {
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
  for (const r of adRows) {
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
  const fold = (rows, pick, keys, preBucketed = false) => {
    for (const b of (preBucketed ? rows : bucketSeries(rows, grain, pick))) {
      const slot = merged.get(b.key) || { key: b.key, label: b.label };
      for (const k of keys) slot[k] = (slot[k] || 0) + (b[k] || 0);
      merged.set(b.key, slot);
    }
  };
  fold(amz.rows, (r) => ({ amazon: Number(r.ordered_sales) || 0, units: r.units_ordered || 0 }), ["amazon", "units"]);
  // Traffic comes from its own per-day table. It used to be summed off the
  // per-SKU sales rows, deduped by ASIN — but those rows carried single-day
  // Catchr figures that overstated sessions by about half, and per-SKU-daily
  // traffic is not obtainable from any source anyway. See migration 0018.
  fold(traffic.rows, (r) => ({ sessions: r.sessions || 0, pageViews: r.page_views || 0 }),
       ["sessions", "pageViews"]);
  fold(shop.rows, (r) => ({ shopify: Number(r.net_sales) || 0 }), ["shopify"]);
  fold(adRows, (r) => ({ spend: Number(r.cost) || 0 }), ["spend"]);
  const daily = [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((d) => {
    const partial = isPartialBucket(d.key, grain, DATA_START, todayIso);
    const rev = (d.amazon || 0) + (d.shopify || 0);
    return { ...d, amazon: d.amazon || 0, shopify: d.shopify || 0, spend: d.spend || 0,
             units: d.units || 0, sessions: d.sessions || 0, pageViews: d.pageViews || 0,
             cvr: (d.sessions || 0) > 0 ? (d.units || 0) / d.sessions : 0,
             revenue: rev, partial, tipLabel: partial ? `${d.label} (partial)` : d.label };
  });

  // Sessions by source, plus a per-day series so a chart can trend organic
  // against everything else. Missing table or empty result degrades to
  // zeroed totals rather than throwing — the widgets show an empty state.
  const seoTotals = {};
  const seoByDay = new Map();
  for (const r of seoRows?.rows || []) {
    const src = r.referrer_source || "unknown";
    const n = Number(r.sessions) || 0;
    seoTotals[src] = (seoTotals[src] || 0) + n;
    const slot = seoByDay.get(r.date) || { date: r.date, total: 0, search: 0 };
    slot.total += n;
    if (src === "search") slot.search += n;
    seoByDay.set(r.date, slot);
  }
  const seo = {
    totals: seoTotals,
    daily: [...seoByDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    error: seoRows?.error || null,
  };

  // Per-SKU ad spend. This is the join that makes per-product ACOS real —
  // it exists only for Amazon, because only Amazon Ads reports an
  // advertised SKU.
  const adBySku = new Map();
  for (const r of adsBySku?.rows || []) {
    const key = r.sku || r.amazon_sku;
    if (!key) continue;
    const a = adBySku.get(key) || { cost: 0, sales: 0, clicks: 0 };
    a.cost += Number(r.cost) || 0;
    a.sales += Number(r.attributed_sales) || 0;
    a.clicks += Number(r.clicks) || 0;
    adBySku.set(key, a);
  }

  ctx = {
    period, grain, amz, shop, ads: { rows: adRows }, runs, fba, seo, adBySku,
    storeCosts: (storeCostRows?.rows || [])[0] || {},
    shopSales,
    amzT, shopT, adT, adM, revenue, bySku, byProduct, amzOrders,
    // Search Console, rolled up across the window. Position is re-weighted
    // by impressions inside rollupSearch — it is an average rank, not a
    // count, so it can never be summed or averaged flat.
    search: {
      queries: rollupSearch(seoQueryRows?.rows || [], "query"),
      pages: rollupSearch(seoPageRows?.rows || [], "page_path"),
      error: seoQueryRows?.error || seoPageRows?.error || null,
    },
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
      shipToCustomer: s.shipToCustomer || 0,
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
  // Shopify units also carry COGS and inbound freight. They used to carry
  // neither: costs were charged only against ctx.bySku, which is Amazon, so
  // every storefront sale landed in revenue at 100% margin. Lines that don't
  // resolve to a catalog SKU stay uncosted and are counted, rather than
  // being charged a guessed rate.
  let shopCostedUnits = 0;
  for (const r of ctx.shopSales?.rows || []) {
    const units = r.net_quantity || 0;
    if (units <= 0) continue;
    const c = costBySku.get(resolveShopifySku(r.product_title, r.variant_title));
    if (!c) { uncosted += units; continue; }
    cogs += units * c.cogs;
    shipping += units * c.shipCost;
    shopCostedUnits += units;
  }

  // Outbound shipping. This used to be charged on Shopify units alone, on
  // the reasoning that Amazon orders are picked, packed and shipped inside
  // the FBA fee. That is not what is happening: 128 of 130 Amazon order
  // items are merchant-fulfilled, so Ovena buys that postage itself, and
  // leaving it out understated cost by roughly $550 on 125 units.
  //
  // The genuine FBA lines are excluded by their "-FBA" seller SKU suffix,
  // which is how the FBA listings are named. Once amz_orders lands this
  // should read fulfillment_channel instead — the report states it outright
  // rather than leaving it to a naming convention.
  // Charged per SHIPMENT, not per unit. The rates are parcel estimates —
  // ground from California for one box — so a two-unit order buys one label,
  // not two. Amazon averages 1.21 units per order, and billing per unit
  // overstated postage by $96.69 across this window.
  //
  // Amazon's shipment count is now exact: distinct order ids from
  // amz_orders, excluding anything Amazon fulfils. It was approximated by
  // order lines, which counted a two-SKU order twice — 118 against 103 real
  // shipments. fulfillment_channel states who ships rather than inferring it
  // from a "-FBA" suffix on the seller SKU.
  //
  // Falls back to the old line-count approximation when amz_orders is empty,
  // so the P&L still reports something if the order import has not run.
  const shopShipments = ctx.shopT.orders || 0;
  const fbmOrders = new Set();
  for (const r of ctx.amzOrders?.rows || []) {
    if ((r.quantity || 0) > 0 && r.fulfillment_channel !== "Amazon") fbmOrders.add(r.amazon_order_id);
  }
  const amzShipments = fbmOrders.size || (ctx.amz?.rows || []).reduce(
    (n, r) => n + (/-FBA$/i.test(r.amazon_sku || "") ? 0 : (r.order_items || 0)),
    0,
  );
  const rated = invRows.filter((r) => r.shipToCustomer > 0);
  const avgOutbound = rated.length
    ? rated.reduce((a, r) => a + r.shipToCustomer, 0) / rated.length
    : 0;
  const outbound = (shopShipments + amzShipments) * (Number.isFinite(avgOutbound) ? avgOutbound : 0);

  // Payment processing: a percentage of Shopify net plus a flat amount per
  // order. Amazon's cut is already inside its referral fee.
  const sc = ctx.storeCosts || {};
  const payment = (ctx.shopT.net || 0) * (Number(sc.payment_fee_pct) || 0)
                + (ctx.shopT.orders || 0) * (Number(sc.payment_fee_flat) || 0);

  // Storage is a monthly charge, prorated across the window being viewed.
  // Counted in calendar days, not buckets: ctx.daily holds one entry per
  // BUCKET, so at week grain this was billing four days for a four-week
  // window and at month grain one day for a month.
  const days = Math.max(1, ctx.available || ctx.daily.length);
  const storage = ((Number(sc.fba_storage_month) || 0) / 30) * days;

  const contribution = ctx.revenue - fees - cogs - shipping - outbound - payment - storage;
  ctx.invRows = invRows;
  ctx.invT = invT;
  ctx.pl = {
    fees, cogs, shipping, outbound, payment, storage, contribution, uncosted,
    // Which lines have no rate on file, so the P&L can say "not recorded"
    // instead of showing a $0.00 cost that reads as a fact.
    unset: [
      outbound === 0 && shopUnits > 0 ? "outbound shipping" : null,
      payment === 0 && (ctx.shopT.orders || 0) > 0 ? "payment processing" : null,
      storage === 0 ? "FBA storage" : null,
    ].filter(Boolean),
    adSpend: ctx.adT.cost, net: contribution - ctx.adT.cost,
  };
}

// ─── Painting ────────────────────────────────────────────────────────

function paint() {
  if (!ctx || !panelEl) return;
  paintEditBar();
  const body = panelEl.querySelector(`#${P}Body`);

  const cards = layout.map((item, i) => {
    const w = WIDGET_MAP.get(item.id);
    if (!w) return "";
    let inner;
    try {
      inner = w.render(ctx, item.w);
    } catch (err) {
      inner = `<div class="card"><div class="card-body"><div class="empty">
        “${escapeHtml(w.title)}” failed to render: ${escapeHtml(err.message)}</div></div></div>`;
    }
    return `
      <div class="w${editing ? " is-editing" : ""}"
           style="--span:${item.w}; --col:${(item.x ?? 0) + 1}; --row:${(item.y ?? 0) + 1}"
           ${editing ? 'draggable="true"' : ""}
           data-span="${item.w}" data-x="${item.x ?? 0}" data-y="${item.y ?? 0}"
           data-widget="${escapeHtml(item.id)}" data-i="${i}">
        ${editing ? `
          <div class="w-tools">
            <button type="button" class="w-btn w-grip" data-i="${i}"
                    aria-label="Drag ${escapeHtml(w.title)} to reorder" title="Drag to reorder">⠿</button>
            <span class="w-span" role="group" aria-label="Width">
              ${SPANS.filter((s) => allowedSpans(item.id).includes(s.w)).map((s) => `<button type="button" class="w-btn${s.w === item.w ? " is-on" : ""}"
                data-setspan="${s.w}" data-i="${i}" aria-pressed="${s.w === item.w}"
                title="${s.w} of 12 columns">${s.label}</button>`).join("")}
            </span>
            <button type="button" class="w-btn" data-move="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button type="button" class="w-btn" data-move="down" data-i="${i}" ${i === layout.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            <button type="button" class="w-btn danger" data-remove="${i}" aria-label="Remove">×</button>
          </div>` : ""}
        ${inner}
      </div>`;
  }).join("");

  // The revenue-definitions note only belongs on tabs that actually report
  // revenue. On a traffic-only tab it is noise about numbers the tab does
  // not show — SEO was opening with a paragraph about TACOS and FBA fees.
  const reportsRevenue = cfg.groups.some((g) => ["Headline", "Amazon", "Shopify"].includes(g));
  const revenueNote = reportsRevenue ? `
    <div class="insight">
      <div class="ico">i</div>
      <div class="body">
        Amazon reports <strong>ordered product sales</strong> — before refunds and before its referral
        and FBA fees. Shopify reports <strong>net of refunds</strong>. The combined figure mixes the two,
        so treat it as an upper bound. No blended ROAS is shown: Meta and Google can't observe Amazon
        purchases, so only <strong>TACOS</strong> is meaningful across channels.
      </div>
    </div>` : "";

  body.innerHTML = `
    ${revenueNote}
    <div class="w-grid">${cards || `<div class="empty">No widgets. Click <strong>Edit dashboard</strong> to add some.</div>`}</div>
  `;

  // Remove by index, not by id — the same widget may appear more than once.
  body.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      layout.splice(Number(b.dataset.remove), 1);
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
  body.querySelectorAll("[data-setspan]").forEach((b) =>
    b.addEventListener("click", () => {
      layout[Number(b.dataset.i)].w = Number(b.dataset.setspan);
      void saveLayout(); paint();
    }));

  if (editing) wireDragDrop(body);

  drawAll();
}

function paintEditBar() {
  const bar = panelEl.querySelector(`#${P}EditBar`);
  panelEl.querySelector(`#${P}Edit`).textContent = editing ? "Done editing" : "Edit dashboard";
  if (!editing) { bar.innerHTML = ""; return; }

  const counts = layout.reduce((m, it) => m.set(it.id, (m.get(it.id) || 0) + 1), new Map());
  bar.innerHTML = `
    <div class="edit-bar">
      <div class="edit-row">
        <strong>Editing</strong>
        <span class="hint">${layout.length} placed of ${CATALOG.length} · ¼ ⅓ ½ ⅔ Full sets width · ↑ ↓ reorders · × removes</span>
        <span class="spacer"></span>
        <span class="hint" id="${P}SaveNote"></span>
        <button type="button" class="btn" id="${P}Add">${picking ? "Close picker" : "Add widgets"}</button>
        <button type="button" class="btn" id="${P}Reset">Reset to default</button>
      </div>
      ${picking ? `
        <div class="picker-head">
          <span class="hint">Tick as many as you like, then add them in one go.</span>
          <span class="spacer"></span>
          <button type="button" class="btn" id="${P}PickAll">Select all</button>
          <button type="button" class="btn" id="${P}PickNone">Clear</button>
          <button type="button" class="btn primary" id="${P}AddSel" ${selected.size ? "" : "disabled"}>
            ${selected.size ? `Add ${selected.size} widget${selected.size === 1 ? "" : "s"}` : "Add widgets"}
          </button>
        </div>
        <div class="picker">
          ${CATALOG_GROUPS.map((g) => `
            <div class="picker-group">
              <h4>${escapeHtml(g)}</h4>
              ${CATALOG.filter((w) => w.group === g).map((w) => `
                <label class="pick${selected.has(w.id) ? " is-sel" : ""}">
                  <input type="checkbox" data-pick="${escapeHtml(w.id)}" ${selected.has(w.id) ? "checked" : ""} />
                  <span class="pick-title">${escapeHtml(w.title)}</span>
                  ${counts.get(w.id) ? `<span class="chip">on page${counts.get(w.id) > 1 ? ` ×${counts.get(w.id)}` : ""}</span>` : ""}
                  <span class="pick-size">${w.size}</span>
                </label>`).join("")}
            </div>`).join("")}
        </div>` : ""}
    </div>`;

  bar.querySelector(`#${P}Add`).addEventListener("click", () => {
    picking = !picking;
    if (!picking) selected.clear();
    paintEditBar();
  });
  bar.querySelector(`#${P}Reset`).addEventListener("click", () => {
    layout = defaultLayout(); selected.clear(); void saveLayout(); paint();
  });

  bar.querySelectorAll("[data-pick]").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.pick); else selected.delete(cb.dataset.pick);
      paintEditBar();   // refresh the count on the Add button
    }));
  bar.querySelector(`#${P}PickAll`)?.addEventListener("click", () => {
    CATALOG.forEach((w) => selected.add(w.id)); paintEditBar();
  });
  bar.querySelector(`#${P}PickNone`)?.addEventListener("click", () => { selected.clear(); paintEditBar(); });
  bar.querySelector(`#${P}AddSel`)?.addEventListener("click", () => {
    // Catalogue order, not tick order, so a bulk add lands in a sane sequence.
    for (const w of CATALOG) if (selected.has(w.id)) layout.push({ id: w.id, w: defaultSpan(w.id) });
    selected.clear(); picking = false;
    void saveLayout(); paint();
  });
}

// ─── Drag to reorder ─────────────────────────────────────────────────
//
// Native HTML5 drag-and-drop, gated to a grip handle. Without the gate the
// whole card is draggable, and pressing any button inside it (width, remove)
// starts a drag instead of clicking. The ↑ ↓ buttons stay: drag alone is
// unusable by keyboard, and this is the only way to reorder.

let dragFrom = null;
let dragAllowed = false;

function clearDropMarks(root) {
  root.querySelectorAll(".drop-before, .drop-after")
    .forEach((n) => n.classList.remove("drop-before", "drop-after"));
}

function wireDragDrop(root) {
  root.querySelectorAll(".w-grip").forEach((g) => {
    const arm = () => { dragAllowed = true; };
    g.addEventListener("mousedown", arm);
    g.addEventListener("touchstart", arm, { passive: true });
  });
  // Disarm however the gesture ends, or the next click-drag anywhere would
  // be treated as an authorised reorder.
  window.addEventListener("mouseup", () => { dragAllowed = false; }, { once: true });

  root.querySelectorAll(".w").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      if (!dragAllowed) { e.preventDefault(); return; }
      dragFrom = Number(el.dataset.i);
      el.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(dragFrom));   // Firefox needs a payload
    });

    el.addEventListener("dragend", () => {
      dragFrom = null; dragAllowed = false;
      el.classList.remove("is-dragging");
      clearDropMarks(root);
    });

    el.addEventListener("dragover", (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
  });

  // The grid itself takes the drop, not just the widgets, so a widget can be
  // dropped into empty space and simply stay there. That is what allows gaps:
  // nothing reflows to close them.
  root.addEventListener("dragover", (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    const cell = cellFromPoint(root, e.clientX, e.clientY);
    if (cell) showGhost(root, cell, layout[dragFrom].w);
  });
  root.addEventListener("dragleave", (e) => {
    if (!root.contains(e.relatedTarget)) clearGhost(root);
  });
  root.addEventListener("drop", (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    clearGhost(root);
    const cell = cellFromPoint(root, e.clientX, e.clientY);
    if (!cell) { dragFrom = null; dragAllowed = false; return; }

    const moving = layout[dragFrom];
    const from = { x: moving.x, y: moving.y };
    const x = Math.max(0, Math.min(COLS - moving.w, cell.col));
    const y = Math.max(0, cell.row);

    // Anything whose footprint the drop lands on trades places with the
    // widget being moved, rather than the drop being refused. One occupant
    // swaps; several are pushed down a row, because there is no sensible
    // single partner to swap with.
    const hit = layout.filter((it, i) =>
      i !== dragFrom && it.y === y && x < it.x + it.w && it.x < x + moving.w);

    moving.x = x;
    moving.y = y;
    if (hit.length === 1) {
      hit[0].x = Math.max(0, Math.min(COLS - hit[0].w, from.x ?? 0));
      hit[0].y = from.y ?? 0;
    } else {
      for (const it of hit) it.y += 1;
    }

    dragFrom = null;
    dragAllowed = false;
    void saveLayout();
    paint();
  });
}

// Which grid cell a pointer is over. Columns divide evenly; rows do not,
// because each sizes to its tallest widget — so row boundaries are read back
// from the resolved template rather than assumed.
function cellFromPoint(grid, clientX, clientY) {
  const r = grid.getBoundingClientRect();
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.columnGap) || 0;
  const colW = (r.width - gap * (COLS - 1)) / COLS;
  const col = Math.max(0, Math.min(COLS - 1, Math.floor((clientX - r.left) / (colW + gap))));

  const rowGap = parseFloat(cs.rowGap) || 0;
  const rows = cs.gridTemplateRows.split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));
  let y = r.top, row = 0;
  for (let i = 0; i < rows.length; i++) {
    if (clientY < y + rows[i] + rowGap / 2) { row = i; break; }
    y += rows[i] + rowGap;
    row = i + 1;
  }
  return { col, row };
}

function showGhost(grid, cell, w) {
  let g = grid.querySelector(".w-ghost");
  if (!g) {
    g = document.createElement("div");
    g.className = "w-ghost";
    grid.appendChild(g);
  }
  g.style.setProperty("--col", Math.max(0, Math.min(COLS - w, cell.col)) + 1);
  g.style.setProperty("--row", cell.row + 1);
  g.style.setProperty("--span", w);
}

function clearGhost(grid) {
  grid.querySelector(".w-ghost")?.remove();
}

function drawAll() {
  if (!ctx || !panelEl) return;
  // Keyed on position, not id — the same widget can appear more than once,
  // and each copy needs its own chart drawn into its own node.
  layout.forEach((item, i) => {
    const w = WIDGET_MAP.get(item.id);
    if (!w?.draw) return;
    const host = panelEl.querySelector(`.w[data-i="${i}"]`);
    if (host) { try { w.draw(host, ctx, item.w); } catch { /* a chart failing must not blank the page */ } }
  });
}

  return mount;
}
