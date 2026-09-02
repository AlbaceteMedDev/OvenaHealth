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
//   syncJobs       jobs the "Sync now" button pulls, in order; omit for none

import {
  fetchSales, fetchAds, fetchShopSales, fetchShopTotals, fetchSyncStatus, fetchFbaInventory,
  fetchSeoSessions, fetchAdsBySku, fetchStoreCosts, fetchTraffic, fetchAmzOrders, fetchAmzTransactions,
  fetchSeoQueries, fetchSeoPages, rollupSearch,
  fetchGaChannels, fetchGaLandingPages, rollupGa,
  salesTotals, salesBySku, adTotals, adMetrics, shopTotals, shopByProduct,
  daysAvailable, PLATFORM_LABELS, DATA_START, clearCache,
  fetchShipLabels, postageByDay,
} from "./data/live.js";
import { bucketSeries, isPartialBucket } from "./series.js";
import { seedInventory, skuMap, resolveShopifySku, resolveSku } from "./data/inventory.js";
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

import {
  COLS, SPANS, HEIGHTS, overlaps, findFreeCell, settle, autoPlace,
} from "./placement.js";
import { todayInReportTz } from "./config.js";

// Re-exported so the tabs and tests have one import site for the grid model.
export { COLS, SPANS, HEIGHTS, overlaps, findFreeCell, settle, autoPlace };

// Row boundaries in client coordinates. Columns divide evenly; rows do not,
// because each sizes to its tallest widget — so they are read back from the
// resolved template rather than assumed.
function measureRows(grid) {
  const r = grid.getBoundingClientRect();
  const cs = getComputedStyle(grid);
  const rowGap = parseFloat(cs.rowGap) || 0;
  const heights = cs.gridTemplateRows.split(" ")
    .map(parseFloat).filter((n) => !Number.isNaN(n));
  const rows = [];
  let top = r.top;
  for (const h of heights) { rows.push({ top, bottom: top + h }); top += h + rowGap; }
  return rows;
}

// Disarm the drag grip however the gesture ends, wherever it ends. Registered
// once for the module rather than per paint, which used to add a fresh
// {once:true} listener on every repaint and leave the grip armed after the
// first mouseup consumed one of them.
let dragAllowed = false;
if (typeof window !== "undefined") {
  window.addEventListener("mouseup", () => { dragAllowed = false; });
}

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

// Every width is offered for every widget. Widgets still DECLARE the widths
// their content suits, and defaultSpan below uses that to pick a sensible
// starting size — but a declaration is a recommendation now, not a veto.
// Filtering the buttons by it meant the charts were pinned at half-width or
// wider with no way down: the control existed, it just had nothing smaller to
// offer on exactly the widgets that were too big.
const allowedSpans = () => SPANS.map((s) => s.w);

// The width a widget's own catalogue entry recommends, used only as a default.
const recommendedSpans = (id) => WIDGET_MAP.get(id)?.spans ?? SPANS.map((s) => s.w);

// A widget's natural width when it has never been resized.
const defaultSpan = (id) => {
  const natural = { kpi: 3, half: 6, full: 12 }[WIDGET_MAP.get(id)?.size] ?? 6;
  const ok = recommendedSpans(id);
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
// Placement lives at module scope — see overlaps / settle / autoPlace above.

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
    const w = allowedSpans().includes(raw) ? raw : defaultSpan(id);
    const xr = Number(entry?.x), yr = Number(entry?.y);
    const x = Number.isInteger(xr) ? Math.max(0, Math.min(COLS - w, xr)) : null;
    const y = Number.isInteger(yr) && yr >= 0 ? yr : null;
    // Layouts saved before row spans existed carry no h; one row is what they
    // were rendered at, so that is what they keep.
    const hr = Number(entry?.h);
    const h = HEIGHTS.some((s) => s.h === hr) ? hr : 1;
    out.push({ id, w, h, x, y });
  }
  return out.length ? autoPlace(out) : null;
}

const defaultLayout = () =>
  autoPlace(cfg.defaultLayout.map((id) => ({ id, w: defaultSpan(id), h: 1, x: null, y: null })));

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
        ${(cfg.syncJobs || []).length ? `<button type="button" class="btn ghost" id="${P}SyncNow"
                title="Pull the latest orders from the platforms now, then reload this page">Sync now</button>` : ""}
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
  wireSyncNow(el);

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

// ─── Sync now ────────────────────────────────────────────────────────
//
// A sync is not a refresh. Reloading re-reads Supabase; this asks the
// platforms for new data first, then re-reads.
//
// Worth having on Overview specifically because Shopify is live: the Admin
// API will return an order placed a minute ago, while the cron that loads it
// runs on the half hour. Between runs this page can be up to thirty minutes
// behind a storefront sale, and no amount of reloading closes that gap.
//
// The jobs run one at a time, not in parallel. Each sync deletes and
// re-inserts its own rows, they share a connection and a function timeout,
// and a partial failure is far easier to read when the jobs are ordered.
// Shopify goes first because it is the fastest and the one being waited on.
function wireSyncNow(el) {
  const btn = el.querySelector(`#${P}SyncNow`);
  if (!btn) return;
  const jobs = cfg.syncJobs || [];

  const say = (text, warn) => {
    const line = panelEl?.querySelector(`#${P}Sync`);
    if (line) line.innerHTML = `<div class="syncline">${warn ? "⚠️ " : ""}${escapeHtml(text)}</div>`;
  };

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Syncing…";

    const done = [];
    const stillRunning = [];
    const failed = [];
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) { say("Not signed in — reload the page.", true); return; }

      for (const job of jobs) {
        say(`Pulling ${job} … (${done.length + stillRunning.length + failed.length + 1} of ${jobs.length})`);
        try {
          const res = await fetch(`/api/sync-now?job=${encodeURIComponent(job)}`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            // The function keeps running after the browser gives up, so a
            // timeout is reported as still running, never as failed.
            signal: AbortSignal.timeout(120_000),
          });
          const body = await res.json().catch(() => null);
          // 429 and 409 are the rate limits working: this job is already as
          // fresh as it can be. That is a success for the button's purpose.
          if (res.ok || res.status === 429 || res.status === 409) done.push(job);
          else failed.push(`${job}: ${body?.error || `HTTP ${res.status}`}`);
        } catch (err) {
          // The serverless function keeps going after the browser gives up,
          // and Catchr routinely takes longer than the two minutes waited
          // here. That is a slow job, not a broken one, so it is reported
          // apart from the failures and does not raise the warning.
          if (err?.name === "TimeoutError") stillRunning.push(job);
          else failed.push(`${job}: ${err.message}`);
        }
      }

      // Without this the 60-second read cache returns the pre-sync rows and a
      // successful sync looks like it did nothing.
      clearCache();
      await render();

      say([
        done.length ? `Synced ${done.join(", ")}.` : null,
        stillRunning.length
          ? `${stillRunning.join(", ")} still running on the server — refresh in a minute to see it.`
          : null,
        failed.length ? `Failed — ${failed.join("; ")}` : null,
        failed.length ? null : "Amazon and advertising report 1–3 days behind, so their newest days fill in later.",
      ].filter(Boolean).join(" "), failed.length > 0);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

// ─── Data ────────────────────────────────────────────────────────────

async function render() {
  const body = panelEl.querySelector(`#${P}Body`);
  body.innerHTML = loadingBox();

  const [amz, shop, shopSales, ads, runs, fba, seoRows, adsBySku, storeCostRows, traffic, amzOrders,
         seoQueryRows, seoPageRows, gaChannelRows, gaPageRows, savedLayout, amzTxns,
         shipLabels] = await Promise.all([
    fetchSales(period), fetchShopTotals(period), fetchShopSales(period),
    fetchAds(period), fetchSyncStatus(), fetchFbaInventory(),
    fetchSeoSessions(period),
    fetchAdsBySku(period),
    fetchStoreCosts(),
    fetchTraffic(period),
    fetchAmzOrders(period),
    fetchSeoQueries(period),
    fetchSeoPages(period),
    fetchGaChannels(period),
    fetchGaLandingPages(period),
    layout ? Promise.resolve(layout) : loadLayout(),
    fetchAmzTransactions(period),
    fetchShipLabels(period),
  ]);
  layout = savedLayout;

  // The badge follows the jobs this tab actually depends on (cfg.syncJobs),
  // not the ads job for everyone. Hard-coded to catchr, the Shopify tab said
  // "Live" through a full day of Shopify 401s, because the ads sync was fine.
  // With several jobs, the worst one wins: a failing feed anywhere here is
  // not "Live".
  const JOB_LABELS = { shopify: "Shopify sync", orders: "Amazon orders sync", catchr: "Ad sync" };
  const RANK = { off: 0, stale: 1, live: 2 };
  const jobs = (cfg.syncJobs || []).length ? cfg.syncJobs : ["catchr"];
  const worst = jobs
    .map((j) => ({ job: j, ...syncStateFor(runs.rows, j) }))
    .sort((a, b) => RANK[a.state] - RANK[b.state])[0];
  panelEl.querySelector(`#${P}Badge`).innerHTML = syncBadge(worst);
  panelEl.querySelector(`#${P}Sync`).innerHTML = syncLine(worst, JOB_LABELS[worst.job] || `${worst.job} sync`);

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
  // Storefront revenue is product PLUS postage. Charging outbound shipping as
  // a cost below while counting none of what the customer paid toward it read
  // $195.86 low across 2026-07-19..08-30 — see migration 0022.
  const revenue = amzT.revenue + shopT.revenue;
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
        // Amazon reports FBA and merchant-fulfilled sales of one catalog SKU
        // as separate seller SKUs (CWD-4X4-FBA vs CWD-4X4), so a day can have
        // two rows for the same product. Without saying which is which, the
        // pair reads as a duplicate.
        channel: /-FBA$/i.test(r.amazon_sku || "") ? "FBA" : "FBM",
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
  const todayIso = todayInReportTz();   // the store's day, not UTC's
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
  // Product plus the postage the customer paid, matching the Shopify half of
  // the total-revenue KPI. Charting net alone while the KPI counted postage
  // would leave the two disagreeing by the shipping line.
  fold(shop.rows, (r) => ({ shopify: (Number(r.net_sales) || 0) + (Number(r.shipping) || 0) }), ["shopify"]);
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
    amzT, shopT, adT, adM, revenue, bySku, byProduct, amzOrders, amzTxns,
    postage: postageByDay(shipLabels.rows),
    // Search Console, rolled up across the window. Position is re-weighted
    // by impressions inside rollupSearch — it is an average rank, not a
    // count, so it can never be summed or averaged flat.
    search: {
      queries: rollupSearch(seoQueryRows?.rows || [], "query"),
      pages: rollupSearch(seoPageRows?.rows || [], "page_path"),
      error: seoQueryRows?.error || seoPageRows?.error || null,
    },
    // GA4 acquisition. Every field here is a count or an amount, so a plain
    // sum is correct — unlike Search Console's position.
    ga: {
      channels: rollupGa(gaChannelRows?.rows || [], "channel_group"),
      pages: rollupGa(gaPageRows?.rows || [], "landing_page"),
      error: gaChannelRows?.error || gaPageRows?.error || null,
    },
    spendByPlatform, campaigns, salesLog, daily,
    available: daysAvailable(),
    exportData: {
      name: "overview", grain,
      rows: daily.map((d) => ({
        bucket: d.label, key: d.key, partial: d.partial ? "yes" : "",
        amazon: d.amazon.toFixed(2), shopify_revenue: d.shopify.toFixed(2),
        total_revenue: d.revenue.toFixed(2), ad_spend: d.spend.toFixed(2),
        tacos: d.revenue > 0 ? ((d.spend / d.revenue) * 100).toFixed(1) + "%" : "",
      })),
      columns: [
        { key: "bucket", label: grain }, { key: "key", label: "key" }, { key: "partial", label: "partial_bucket" },
        { key: "amazon", label: "amazon_ordered_sales" }, { key: "shopify_revenue", label: "shopify_revenue_incl_shipping" },
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
      cogs: s.cogs || 0, amazonFee: s.amazonFee || 0, amazonFeeFba: s.amazonFeeFba || 0,
      shipCost: s.shipCost || 0,
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

  // Amazon charges two different fees and which one applies depends on who
  // ships. amazon_fee is referral only; amazon_fee_fba is referral PLUS
  // fulfilment and runs 4-9x higher. Everything was charged the merchant
  // rate, so the fulfilment half of every FBA sale never reached the P&L.
  //
  // Units come from amz_sales_daily, which does not say who fulfilled them,
  // so the split is read from amz_orders — which does. Its sku is the SELLER
  // sku ("SOCK-AID-FBA"), not the catalog sku, which is why resolveSku is
  // needed and why a plain join would have silently matched nothing.
  const fbaUnitsBySku = new Map();
  for (const r of ctx.amzOrders?.rows || []) {
    if (r.fulfillment_channel !== "Amazon") continue;
    if (r.order_status === "Cancelled") continue;
    const row = resolveSku(r.sku, null);
    if (!row) continue;
    fbaUnitsBySku.set(row.sku, (fbaUnitsBySku.get(row.sku) || 0) + (r.quantity || 0));
  }

  let fees = 0, cogs = 0, shipping = 0, uncosted = 0, fbaUnitsCharged = 0;
  for (const s of ctx.bySku) {
    const c = costBySku.get(s.sku);
    if (!c || (c.cogs === 0 && c.amazonFee === 0)) { uncosted += s.units; continue; }
    // Clamped to the units this window actually reports: the two tables can
    // disagree at the edges of the window, and an unclamped count could
    // charge the FBA rate to more units than were sold.
    const fbaUnits = Math.min(s.units, fbaUnitsBySku.get(s.sku) || 0);
    const fbmUnits = Math.max(0, s.units - fbaUnits);
    // No FBA rate on file falls back to the merchant rate — the number it
    // has always used, rather than a guess or a zero.
    const fbaRate = c.amazonFeeFba > 0 ? c.amazonFeeFba : c.amazonFee;
    fees += fbmUnits * c.amazonFee + fbaUnits * fbaRate;
    fbaUnitsCharged += fbaUnits;
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
  const estimateRate = Number.isFinite(avgOutbound) ? avgOutbound : 0;
  const shipments = shopShipments + amzShipments;

  // ─── Postage: measured where it can be, estimated where it cannot ──
  //
  // Everything above this line estimates: shipments counted from orders,
  // times an average rate. Both inputs were wrong. Against the real print
  // history for 2026-07-22..08-26 the estimate came to $677.60 where
  // $1,860.02 had been paid — the rate less than half ($4.40 against $9.38),
  // and the shipment count 27% low, because one order is not one label. A
  // multi-box order buys several and a reship buys another, and nothing
  // derived from the order table can see either.
  //
  // So imported labels win wherever they reach. The COVERED RANGE is what
  // makes that safe: inside it, a day with no labels really shipped nothing
  // and costs zero; outside it, nothing was imported and the estimate still
  // stands. Without that distinction, importing last month would silently
  // zero this month's shipping.
  const postage = ctx.postage || { byDay: new Map(), from: null, to: null, total: 0, labels: 0 };
  let outboundActual = 0;
  let outboundEstimated = 0;
  let estimatedDays = 0;
  if (postage.from) {
    for (const b of ctx.daily) {
      const day = String(b.key).slice(0, 10);
      if (day >= postage.from && day <= postage.to) {
        outboundActual += postage.byDay.get(day) || 0;
      } else {
        estimatedDays += 1;
      }
    }
    // Days the import does not reach keep the old estimate, prorated by the
    // share of shipments those days represent rather than by day count —
    // shipments are what postage scales with.
    const share = ctx.daily.length ? estimatedDays / ctx.daily.length : 0;
    outboundEstimated = shipments * estimateRate * share;
  } else {
    outboundEstimated = shipments * estimateRate;
  }
  const outbound = Math.round((outboundActual + outboundEstimated) * 100) / 100;

  // Payment processing: a percentage of what was actually charged plus a flat
  // amount per order. Amazon's cut is already inside its referral fee.
  //
  // The percentage is taken on the whole charge — product, postage AND tax —
  // because that is what the processor bills on. Taking it on product alone
  // understated the fee, which is the same asymmetry the revenue line had,
  // pointing the other way.
  const sc = ctx.storeCosts || {};
  const charged = (ctx.shopT.net || 0) + (ctx.shopT.shipping || 0) + (ctx.shopT.taxes || 0);
  const payment = charged * (Number(sc.payment_fee_pct) || 0)
                + (ctx.shopT.orders || 0) * (Number(sc.payment_fee_flat) || 0);

  // Storage is a monthly charge, prorated across the window being viewed.
  // Counted in calendar days, not buckets: ctx.daily holds one entry per
  // BUCKET, so at week grain this was billing four days for a four-week
  // window and at month grain one day for a month.
  const days = Math.max(1, ctx.available || ctx.daily.length);
  const storage = ((Number(sc.fba_storage_month) || 0) / 30) * days;

  // Amazon's settlement ledger carries costs that belong to no single order:
  // service and subscription fees, inbound freight, shipping bought from
  // Amazon. The table has existed since migration 0018 and nothing read it,
  // so these were simply missing and net profit read better than it was.
  //
  // Order Payment and Refund are excluded deliberately — that is order money,
  // already counted in amz_sales_daily, and charging it here would
  // double-count the entire Amazon top line. Seller repayments are excluded
  // too: a positive disbursement adjustment is not trading income, and
  // booking it as one would flatter the number in the other direction.
  // Signs are Amazon's own — a fee is already negative — so this is added.
  const ORDER_MONEY = new Set(["Order Payment", "Refund", "Paid to Amazon | Seller repayment"]);
  let settlement = 0;
  for (const r of ctx.amzTxns?.rows || []) {
    if (ORDER_MONEY.has(r.transaction_type)) continue;
    // Amazon sometimes settles the Ads invoice out of the payout. That spend is
    // already in ads_daily and charged under Advertising; counting the
    // settlement row too charged it twice ($13.03 in the full window).
    if (/cost of advertising/i.test(r.product_details || "")) continue;
    settlement += Number(r.total_amount) || 0;
  }
  // Held as a positive COST so it reads like every other line in the P&L.
  const amazonCosts = -Math.min(0, settlement);
  // The ledger lags the window: Amazon posts settlements every two weeks and
  // the sync last saw Aug 16. Say where it stops, or the line reads as if it
  // covered the whole period.
  const ledgerTo = (ctx.amzTxns?.rows || []).reduce((m, r) => (r.posted_on > m ? r.posted_on : m), "").slice(0, 10) || null;

  const contribution = ctx.revenue - fees - cogs - shipping - outbound - payment - storage - amazonCosts;
  ctx.invRows = invRows;
  ctx.invT = invT;
  ctx.pl = {
    fees, cogs, shipping, outbound, payment, storage, amazonCosts, contribution, uncosted,
    fbaUnitsCharged,
    ledgerTo,
    // How much of `outbound` is measured and how much is still a guess, so
    // the P&L can say so rather than presenting one number as if it were all
    // of one kind.
    outboundActual: Math.round(outboundActual * 100) / 100,
    outboundEstimated: Math.round(outboundEstimated * 100) / 100,
    // Split by channel, because the two behave nothing alike: the storefront
    // charges the customer for shipping and Amazon merchant-fulfilled orders
    // do not. Scaled by the same measured/estimated proportion as the total,
    // so a partly-covered window does not report a channel split for days no
    // label reaches.
    outboundAmazon: Math.round(postage.amazonFbm * 100) / 100,
    outboundStorefront: Math.round(postage.storefront * 100) / 100,
    postageAttributed: postage.attributed,
    // What Amazon buyers paid toward merchant-fulfilled shipping. Nearly
    // nothing, which is the whole point — the storefront recovers its postage
    // and FBM does not.
    amazonShipCharged: Math.round((ctx.amzOrders?.rows || []).reduce(
      (n, r) => n + (r.fulfillment_channel !== "Amazon" ? Number(r.shipping_price) || 0 : 0), 0) * 100) / 100,
    postageLabels: postage.labels,
    postageFrom: postage.from,
    postageTo: postage.to,
    estimateRate,
    shipments,
    // Which lines have no rate on file, so the P&L can say "not recorded"
    // instead of showing a $0.00 cost that reads as a fact.
    unset: [
      outbound === 0 && (shopShipments + amzShipments) > 0 ? "outbound shipping" : null,
      payment === 0 && (ctx.shopT.orders || 0) > 0 ? "payment processing" : null,
      storage === 0 ? "FBA storage" : null,
      amazonCosts === 0 && (ctx.amzTxns?.rows || []).length === 0 ? "Amazon settlement fees" : null,
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
           style="--span:${item.w}; --rowspan:${item.h || 1}; --col:${(item.x ?? 0) + 1}; --row:${(item.y ?? 0) + 1}"
           ${editing ? 'draggable="true"' : ""}
           data-span="${item.w}" data-h="${item.h || 1}" data-x="${item.x ?? 0}" data-y="${item.y ?? 0}"
           data-widget="${escapeHtml(item.id)}" data-i="${i}">
        ${editing ? `
          <div class="w-tools">
            <button type="button" class="w-btn w-grip" data-i="${i}"
                    aria-label="Drag ${escapeHtml(w.title)} to reorder" title="Drag to reorder">⠿</button>
            <span class="w-span" role="group" aria-label="Width">
              ${SPANS.map((s) => `<button type="button" class="w-btn${s.w === item.w ? " is-on" : ""}"
                data-setspan="${s.w}" data-i="${i}" aria-pressed="${s.w === item.w}"
                title="${s.w} of 12 columns">${s.label}</button>`).join("")}
            </span>
            <span class="w-span" role="group" aria-label="Height">
              ${HEIGHTS.map((s) => `<button type="button" class="w-btn${s.h === (item.h || 1) ? " is-on" : ""}"
                data-setheight="${s.h}" data-i="${i}" aria-pressed="${s.h === (item.h || 1)}"
                title="${s.h} row${s.h > 1 ? "s" : ""} tall">${s.label}</button>`).join("")}
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
  // Swaps the two cells as well as the two array slots. Swapping array order
  // alone did nothing visible: widgets render from their own x/y, so the
  // buttons moved a widget's index and left it sitting where it was. Order
  // still has to swap too — below 1180px placement is off and the grid falls
  // back to flowing in DOM order.
  body.querySelectorAll("[data-move]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.i);
      const j = b.dataset.move === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= layout.length) return;
      const a = layout[i], c = layout[j];
      const ax = a.x, ay = a.y;
      a.x = c.x; a.y = c.y;
      c.x = ax; c.y = ay;
      [layout[i], layout[j]] = [layout[j], layout[i]];
      settle(layout);
      void saveLayout(); paint();
    }));
  // Widening pushes a widget's right edge past its neighbour, or past column
  // 12 entirely. Clamp x to keep the whole footprint on the grid, then let
  // settle move whatever the new width now sits on top of.
  body.querySelectorAll("[data-setspan]").forEach((b) =>
    b.addEventListener("click", () => {
      const it = layout[Number(b.dataset.i)];
      it.w = Number(b.dataset.setspan);
      it.x = Math.max(0, Math.min(COLS - it.w, it.x ?? 0));
      settle(layout, it);
      void saveLayout(); paint();
    }));
  // Growing downward lands on whatever is in the row below, so the resized
  // widget anchors and settle moves the occupants rather than the other way
  // round — the same rule a drop follows.
  body.querySelectorAll("[data-setheight]").forEach((b) =>
    b.addEventListener("click", () => {
      const it = layout[Number(b.dataset.i)];
      it.h = Number(b.dataset.setheight);
      settle(layout, it);
      void saveLayout(); paint();
    }));

  // The grid element, not the body that wraps it. Handing this the body was
  // the whole bug: getComputedStyle on a non-grid reports gridTemplateRows
  // "none", so every drop resolved to row 0 and every widget landed on top of
  // the first one — and the ghost, appended outside the grid, had no cell to
  // sit in and rendered as a bar under the dashboard.
  if (editing) wireDragDrop(body.querySelector(".w-grid"));

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
    // x/y are left null and resolved by autoPlace: added widgets used to carry
    // no cell at all, so every one of them rendered at column 1 row 1, stacked
    // on the first widget and on each other.
    for (const w of CATALOG) {
      if (selected.has(w.id)) layout.push({ id: w.id, w: defaultSpan(w.id), x: null, y: null });
    }
    autoPlace(layout);
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
let dragRows = null;   // row boundaries measured once per drag, see dragstart
// Where inside the widget the pointer grabbed it, in pixels from its left
// edge. Without this the cursor's own column became the widget's LEFT edge,
// so grabbing a wide widget anywhere but its left corner made it jump left by
// most of its own width the moment you moved — which is what made placing one
// beside another so hard to aim.
let dragGrabX = 0;

function wireDragDrop(grid) {
  if (!grid) return;
  grid.querySelectorAll(".w-grip").forEach((g) => {
    const arm = () => { dragAllowed = true; };
    g.addEventListener("mousedown", arm);
    g.addEventListener("touchstart", arm, { passive: true });
  });

  grid.querySelectorAll(".w").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      if (!dragAllowed) { e.preventDefault(); return; }
      dragFrom = Number(el.dataset.i);
      dragGrabX = e.clientX - el.getBoundingClientRect().left;
      el.classList.add("is-dragging");
      // Row heights are read once, here. Measuring them per dragover would
      // feed back on itself: the ghost is a grid child, so as soon as it
      // opens a new row the next measurement includes that row and the
      // target cell jitters under the cursor. Nothing moves mid-drag, so one
      // measurement stays correct for the whole gesture.
      dragRows = measureRows(grid);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(dragFrom));   // Firefox needs a payload
    });

    el.addEventListener("dragend", () => {
      dragFrom = null; dragAllowed = false; dragRows = null; dragGrabX = 0;
      el.classList.remove("is-dragging");
      clearGhost(grid);
    });
  });

  // The grid itself takes the drop, not just the widgets, so a widget can be
  // dropped into empty space and simply stay there. That is what allows gaps:
  // nothing reflows to close them.
  grid.addEventListener("dragover", (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = targetFromPoint(grid, e.clientX, e.clientY);
    showGhost(grid, target, blockedBy(target));
  });
  grid.addEventListener("dragleave", (e) => {
    if (!grid.contains(e.relatedTarget)) clearGhost(grid);
  });
  grid.addEventListener("drop", (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    clearGhost(grid);

    const moving = layout[dragFrom];
    const target = targetFromPoint(grid, e.clientX, e.clientY);
    const from = { x: moving.x, y: moving.y };
    const hit = blockedBy(target);

    moving.x = target.x;
    moving.y = target.y;

    // One occupant trades places with the widget being moved. Several are
    // pushed down, because there is no sensible single partner to swap with.
    // settle() then resolves whatever those moves landed on in turn, with the
    // dropped widget anchored so it keeps the cell the user chose.
    if (hit.length === 1 && Number.isInteger(from.x)) {
      hit[0].x = Math.max(0, Math.min(COLS - hit[0].w, from.x));
      hit[0].y = from.y;
    } else {
      for (const it of hit) it.y += 1;
    }
    settle(layout, moving);

    dragFrom = null;
    dragAllowed = false;
    dragRows = null;
    void saveLayout();
    paint();
  });
}

// The cell a pointer is over, as a full footprint {x, y, w} for the widget
// being dragged — already clamped so the whole widget stays on the grid.
// Pointing below the last row yields a new row, which is how the dashboard
// gets extended downward.
function targetFromPoint(grid, clientX, clientY) {
  const w = layout[dragFrom].w;
  const h = layout[dragFrom].h || 1;
  const r = grid.getBoundingClientRect();
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.columnGap) || 0;
  const colW = (r.width - gap * (COLS - 1)) / COLS;
  const track = colW + gap;

  // The widget's LEFT EDGE is the cursor minus wherever it was grabbed, and it
  // snaps to the NEAREST column rather than the one it happens to be inside.
  // Flooring the raw cursor column meant a boundary was only crossed once the
  // pointer was fully past it, so a widget lined up against its neighbour felt
  // like it resisted the last column. Clamped after, so a full-width widget
  // dropped on the right still lands at column 0 rather than being refused.
  const raw = (clientX - r.left - dragGrabX) / track;
  const col = Math.round(Number.isFinite(raw) ? raw : 0);
  const x = Math.max(0, Math.min(COLS - w, col));

  const rows = dragRows || measureRows(grid);
  let y = rows.length;
  for (let i = 0; i < rows.length; i++) {
    if (clientY < rows[i].bottom) { y = i; break; }
  }
  return { x, y: Math.max(0, y), w, h };
}

// Which placed widgets the proposed footprint would land on.
function blockedBy(target) {
  return layout.filter((it, i) => i !== dragFrom && overlaps(target, it));
}

// The drop preview. Colour and label say what the drop will actually do —
// land in free space, trade places with one widget, or push several down —
// so the outcome is known before the mouse is released rather than after.
function showGhost(grid, target, blocked) {
  let g = grid.querySelector(".w-ghost");
  if (!g) {
    g = document.createElement("div");
    g.innerHTML = '<span class="w-ghost-label"></span>';
    grid.appendChild(g);
  }
  g.style.setProperty("--col", target.x + 1);
  g.style.setProperty("--row", target.y + 1);
  g.style.setProperty("--span", target.w);
  g.style.setProperty("--rowspan", target.h || 1);

  const state = blocked.length === 0 ? "is-free" : blocked.length === 1 ? "is-swap" : "is-push";
  g.className = `w-ghost ${state}`;
  g.querySelector(".w-ghost-label").textContent =
    blocked.length === 0
      ? "Fits here"
      : blocked.length === 1
        ? `Swaps with ${WIDGET_MAP.get(blocked[0].id)?.title || "widget"}`
        : `Pushes ${blocked.length} widgets down`;

  // Outline exactly what is in the way, so a "swap" names its partner on the
  // page instead of only in the label.
  grid.querySelectorAll(".w.is-blocked").forEach((n) => n.classList.remove("is-blocked"));
  for (const it of blocked) {
    grid.querySelector(`.w[data-i="${layout.indexOf(it)}"]`)?.classList.add("is-blocked");
  }
}

function clearGhost(grid) {
  grid.querySelector(".w-ghost")?.remove();
  grid.querySelectorAll(".w.is-blocked").forEach((n) => n.classList.remove("is-blocked"));
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
