// Live read layer for the Amazon store.
//
// The sync jobs in /api write normalized daily rows into Supabase; the
// browser only ever reads them. That keeps the Catchr and SP-API keys
// server-side, and means GitHub Pages (which can't run functions) shows the
// same numbers as Vercel.
//
// Every fetch here resolves to `{ rows, error }` rather than throwing —
// tabs render an explicit "couldn't load" state instead of a blank panel.

import { supabase } from "../supabase.js";
import { skuMap, resolveSku } from "./inventory.js";
import { DATA_START, isExcludedProduct } from "../config.js";

const cache = new Map();
const TTL_MS = 60_000;

function cacheKey(name, args) {
  return `${name}:${JSON.stringify(args)}`;
}

async function cached(name, args, loader) {
  const key = cacheKey(name, args);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await loader();
  // Never cache a failure — the next tab switch should retry.
  if (!value.error) cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearCache() {
  cache.clear();
}

// Inclusive start date, `days` back from today, as YYYY-MM-DD — never
// earlier than DATA_START. Every fetch below goes through this, so the
// reporting floor is enforced in exactly one place.
export function startDateFor(days) {
  if (days === "all") return DATA_START;
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const iso = d.toISOString().slice(0, 10);
  return iso < DATA_START ? DATA_START : iso;
}

// How many days the floor actually allows, so tabs can say "24 days"
// instead of implying a full 90.
export function daysAvailable() {
  const start = Date.parse(`${DATA_START}T00:00:00Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(1, Math.round((today - start) / 86400000) + 1);
}

// True when the requested window is wider than the floor allows — the UI
// uses this to explain why "14d" and "All" can show the same number.
export function isClamped(days) {
  return days === "all" || days > daysAvailable();
}

export { DATA_START };

async function run(query) {
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: null };
}

// ─── Amazon sales + traffic ──────────────────────────────────────────
export function fetchSales(days) {
  return cached("sales", { days }, () =>
    run(
      supabase
        .from("amz_sales_daily")
        .select(
          "date, marketplace_id, amazon_sku, sku, asin, title, ordered_sales, units_ordered, order_items, units_refunded, sessions, page_views, unit_session_pct, buy_box_pct, currency",
        )
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    ),
  );
}

// ─── Ads, per campaign ───────────────────────────────────────────────
export function fetchAds(days) {
  return cached("ads", { days }, () =>
    run(
      supabase
        .from("ads_daily")
        .select(
          "date, platform, account_id, account_name, campaign_id, campaign_name, impressions, clicks, cost, attributed_sales, attributed_orders, attributed_units, currency",
        )
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    ),
  );
}

// ─── Ads, per advertised SKU (Amazon only) ───────────────────────────
export function fetchAdsBySku(days) {
  return cached("adsSku", { days }, () =>
    run(
      supabase
        .from("ads_sku_daily")
        .select("date, platform, amazon_sku, sku, asin, impressions, clicks, cost, attributed_sales, attributed_orders")
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    ),
  );
}

// ─── FBA stock snapshot ──────────────────────────────────────────────
export function fetchFbaInventory() {
  return cached("fba", {}, () =>
    run(
      supabase
        .from("fba_inventory")
        .select(
          "marketplace_id, amazon_sku, sku, asin, fnsku, fulfillable, inbound_working, inbound_shipped, inbound_receiving, reserved, unfulfillable, total, synced_at",
        ),
    ),
  );
}

// ─── Shopify storefront ──────────────────────────────────────────────
// Excluded products (Juzo) are filtered here rather than in SQL so the
// rule lives with the rest of the reporting policy in config.js, and so a
// stale synced row can never leak into a total.
export function fetchShopSales(days) {
  return cached("shopSales", { days }, async () => {
    const out = await run(
      supabase
        .from("shop_sales_daily")
        .select(
          "date, product_title, variant_title, product_id, gross_sales, discounts, net_sales, quantity, net_quantity, orders, currency",
        )
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    );
    if (out.error) return out;
    return { rows: out.rows.filter((r) => !isExcludedProduct(r.product_title)), error: null };
  });
}

export function fetchShopTotals(days) {
  return cached("shopTotals", { days }, () =>
    run(
      supabase
        .from("shop_totals_daily")
        .select("date, gross_sales, discounts, refunds, net_sales, orders, units, currency")
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    ),
  );
}

// ─── Google Merchant Center feed health ──────────────────────────────
export function fetchGmcStatus() {
  return cached("gmc", {}, async () => {
    const [issues, products] = await Promise.all([
      run(supabase.from("gmc_account_issues").select("account_id, title, severity, documentation, synced_at")),
      run(supabase.from("gmc_product_status").select("account_id, product_title, destination_status, availability, synced_at")),
    ]);
    if (issues.error || products.error) {
      return { rows: [], error: issues.error || products.error };
    }
    return {
      rows: [],
      error: null,
      issues: issues.rows,
      products: products.rows.filter((r) => !isExcludedProduct(r.product_title)),
    };
  });
}

// ─── Sync freshness ──────────────────────────────────────────────────
export function fetchSyncStatus() {
  return cached("sync", {}, () =>
    run(
      supabase
        .from("sync_runs")
        .select("job, status, rows_written, started_at, finished_at, detail")
        .order("started_at", { ascending: false })
        .limit(20),
    ),
  );
}

// ─── Shaping helpers ─────────────────────────────────────────────────

// Collapse rows to one entry per day. `pick` maps a row to the numbers to
// add up; every key is summed.
export function byDay(rows, pick) {
  const map = new Map();
  for (const r of rows) {
    const slot = map.get(r.date) || {};
    const vals = pick(r);
    for (const [k, v] of Object.entries(vals)) slot[k] = (slot[k] || 0) + v;
    map.set(r.date, slot);
  }
  return map;
}

// Dense day series so charts don't skip missing dates. Clamped to
// DATA_START — without this a "90d" chart would draw 66 empty days before
// the relaunch and make the trend look like a collapse.
export function denseDays(days, map, keys) {
  const span = days === "all" ? daysAvailable() : Math.min(days, daysAvailable());
  const out = [];
  const today = new Date();
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (key < DATA_START) continue;
    const slot = map.get(key) || {};
    const entry = { label: key };
    for (const k of keys) entry[k] = slot[k] || 0;
    out.push(entry);
  }
  return out;
}

// Roll sales rows up per catalog SKU, folding FBA/MFN listings of the same
// product together. Traffic metrics are per-ASIN in Amazon's report, so two
// seller SKUs on one ASIN repeat the same sessions figure — summing those
// would double-count, so sessions are taken once per (date, ASIN).
export function salesBySku(rows) {
  const bySku = new Map();
  const seenTraffic = new Set();

  for (const r of rows) {
    const sku = r.sku || resolveSku(r.amazon_sku)?.sku || r.amazon_sku;
    if (!bySku.has(sku)) {
      const meta = skuMap.get(sku);
      bySku.set(sku, {
        sku,
        asin: r.asin,
        title: r.title,
        product: meta?.product || r.title || sku,
        variant: meta?.variant || "",
        category: meta?.category || "Uncategorised",
        listed: meta?.listed ?? true,
        revenue: 0,
        units: 0,
        orderItems: 0,
        refunds: 0,
        sessions: 0,
        pageViews: 0,
      });
    }
    const slot = bySku.get(sku);
    slot.revenue += Number(r.ordered_sales) || 0;
    slot.units += r.units_ordered || 0;
    slot.orderItems += r.order_items || 0;
    slot.refunds += r.units_refunded || 0;

    const trafficKey = `${r.date}|${r.asin || r.amazon_sku}`;
    if (!seenTraffic.has(trafficKey)) {
      seenTraffic.add(trafficKey);
      slot.sessions += r.sessions || 0;
      slot.pageViews += r.page_views || 0;
    }
  }

  for (const slot of bySku.values()) {
    slot.cvr = slot.sessions > 0 ? slot.units / slot.sessions : 0;
    slot.refundRate = slot.units > 0 ? slot.refunds / slot.units : 0;
    slot.avgPrice = slot.units > 0 ? slot.revenue / slot.units : 0;
  }
  return [...bySku.values()];
}

// Same dedupe rule as above, for store-wide totals.
export function salesTotals(rows) {
  const seenTraffic = new Set();
  return rows.reduce(
    (acc, r) => {
      acc.revenue += Number(r.ordered_sales) || 0;
      acc.units += r.units_ordered || 0;
      acc.orderItems += r.order_items || 0;
      acc.refunds += r.units_refunded || 0;
      const key = `${r.date}|${r.asin || r.amazon_sku}`;
      if (!seenTraffic.has(key)) {
        seenTraffic.add(key);
        acc.sessions += r.sessions || 0;
        acc.pageViews += r.page_views || 0;
      }
      return acc;
    },
    { revenue: 0, units: 0, orderItems: 0, refunds: 0, sessions: 0, pageViews: 0 },
  );
}

// ─── Shopify shaping ─────────────────────────────────────────────────

export function shopTotals(rows) {
  return rows.reduce(
    (acc, r) => {
      acc.gross += Number(r.gross_sales) || 0;
      acc.discounts += Number(r.discounts) || 0;
      acc.refunds += Number(r.refunds) || 0;
      acc.net += Number(r.net_sales) || 0;
      acc.orders += r.orders || 0;
      acc.units += r.units || 0;
      return acc;
    },
    { gross: 0, discounts: 0, refunds: 0, net: 0, orders: 0, units: 0 },
  );
}

// Roll product rows up per product, folding variants together. Sorted by
// net — a product whose orders were all refunded belongs at the bottom,
// not the top, which is exactly what gross-based ranking gets wrong.
export function shopByProduct(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.product_title || "(untitled)";
    const slot = map.get(key) || {
      product: key,
      gross: 0,
      discounts: 0,
      net: 0,
      quantity: 0,
      netQuantity: 0,
      orders: 0,
      variants: new Set(),
    };
    slot.gross += Number(r.gross_sales) || 0;
    slot.discounts += Number(r.discounts) || 0;
    slot.net += Number(r.net_sales) || 0;
    slot.quantity += r.quantity || 0;
    slot.netQuantity += r.net_quantity || 0;
    slot.orders += r.orders || 0;
    if (r.variant_title) slot.variants.add(r.variant_title);
    map.set(key, slot);
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      variantCount: s.variants.size,
      refunded: s.gross - s.discounts - s.net,
      fullyRefunded: s.gross > 0 && s.net === 0,
    }))
    .sort((a, b) => b.net - a.net);
}

export function adTotals(rows) {
  return rows.reduce(
    (acc, r) => {
      acc.cost += Number(r.cost) || 0;
      acc.sales += Number(r.attributed_sales) || 0;
      acc.impressions += Number(r.impressions) || 0;
      acc.clicks += Number(r.clicks) || 0;
      acc.orders += Number(r.attributed_orders) || 0;
      return acc;
    },
    { cost: 0, sales: 0, impressions: 0, clicks: 0, orders: 0 },
  );
}

// ACOS = ad cost / ad-attributed sales. ROAS is its reciprocal.
// TACOS = ad cost / *total* store sales — the number that actually tells you
// whether advertising is buying profitable growth.
export function adMetrics(t, totalStoreSales = 0) {
  return {
    acos: t.sales > 0 ? t.cost / t.sales : null,
    roas: t.cost > 0 ? t.sales / t.cost : null,
    tacos: totalStoreSales > 0 ? t.cost / totalStoreSales : null,
    ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
    cpc: t.clicks > 0 ? t.cost / t.clicks : 0,
    cvr: t.clicks > 0 ? t.orders / t.clicks : 0,
    cpa: t.orders > 0 ? t.cost / t.orders : null,
  };
}

export const PLATFORM_LABELS = {
  "amazon-ads": "Amazon Ads",
  "facebook-ads": "Meta Ads",
  "google-ads": "Google Ads",
};
