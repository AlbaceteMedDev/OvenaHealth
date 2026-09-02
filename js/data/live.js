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
import { DATA_START, isExcludedProduct, todayInReportTz } from "../config.js";

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
  // Count back from TODAY IN THE REPORTING TIMEZONE, not UTC. Off by a few
  // hours every evening otherwise, which silently shifted every window.
  const d = new Date(`${todayInReportTz()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  const iso = d.toISOString().slice(0, 10);
  return iso < DATA_START ? DATA_START : iso;
}

// How many days the floor actually allows, so tabs can say "24 days"
// instead of implying a full 90.
export function daysAvailable() {
  const start = Date.parse(`${DATA_START}T00:00:00Z`);
  const today = Date.parse(`${todayInReportTz()}T00:00:00Z`);
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

// ─── Amazon traffic, per day ─────────────────────────────────────────
// Separate from fetchSales because sessions cannot be attributed to a SKU
// on a given day. Amazon's Sales & Traffic report is accurate per day and
// accurate per SKU over a window, but the cross of the two is not available
// from any source — see migration 0018. Summing the per-SKU sessions column
// used to stand in for this and overstated traffic by about half.
//
// Returns empty rather than throwing when the table is missing, so a deploy
// that lands before the migration shows an empty chart instead of an error.
export function fetchTraffic(days) {
  return cached("traffic", { days }, () =>
    run(
      supabase
        .from("amz_traffic_daily")
        .select("date, marketplace_id, sessions, page_views, units_ordered, ordered_sales")
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    ),
  );
}

// ─── Amazon orders, item level ───────────────────────────────────────
// Ground truth from Amazon's own All Orders report. One row per order ITEM,
// so an order with two SKUs is two rows sharing an amazon_order_id — which
// is what makes a shipment count (distinct order ids) different from a unit
// count (sum of quantity), and different again from order lines.
//
// Empty rather than throwing when the table is missing.
export function fetchAmzOrders(days) {
  return cached("amzOrders", { days }, () =>
    run(
      supabase
        .from("amz_orders")
        .select("amazon_order_id, purchase_day, sku, quantity, item_price, fulfillment_channel, order_status, ship_state, shipping_price")
        .gte("purchase_day", startDateFor(days))
        .order("purchase_day", { ascending: true }),
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

// Amazon's settlement ledger: subscription, service fees, inbound freight —
// period costs that belong to the business rather than to any one order.
// Migration 0018 created the table and NOTHING ever read it, so these never
// reached the P&L and net profit was reported better than it was.
//
// Order Payment and Refund rows are excluded by the caller, not here: those
// are order money already represented in amz_sales_daily, and charging them
// again would double-count the whole Amazon top line.
export function fetchAmzTransactions(days) {
  return cached("amzTransactions", { days }, () =>
    run(
      supabase
        .from("amz_transactions")
        .select("posted_on, transaction_type, amazon_order_id, total_amount, amazon_fees, other_amount")
        .gte("posted_on", startDateFor(days))
        .order("posted_on", { ascending: true }),
    ),
  );
}

// ─── Shopify storefront ──────────────────────────────────────────────
// Excluded products (Juzo) are filtered here rather than in SQL so the
// rule lives with the rest of the reporting policy in config.js, and so a
// stale synced row can never leak into a total.
// Storefront sessions by acquisition source. Written by the SEO sync; the
// "search" bucket is the organic number the SEO widgets trend.
export function fetchSeoSessions(days) {
  return cached("seoSessions", { days }, () =>
    run(
      supabase
        .from("seo_sessions_daily")
        .select("date, referrer_source, sessions")
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    ),
  );
}

// Search Console: what people typed, and where the store ranked for it.
// Both degrade to empty when the tables or the Catchr authorisation are
// missing, so the SEO tab shows an empty state rather than an error.
//
// Ordered by clicks rather than date: the useful read is "which queries earn
// anything", and the tail is mostly single-impression noise.
export function fetchSeoQueries(days) {
  return cached("seoQueries", { days }, () =>
    run(
      supabase
        .from("seo_queries_daily")
        .select("date, query, clicks, impressions, position")
        .gte("date", startDateFor(days))
        .order("clicks", { ascending: false })
        .limit(2000),
    ),
  );
}

export function fetchSeoPages(days) {
  return cached("seoPages", { days }, () =>
    run(
      supabase
        .from("seo_pages_daily")
        .select("date, page_path, clicks, impressions, position")
        .gte("date", startDateFor(days))
        .order("clicks", { ascending: false })
        .limit(2000),
    ),
  );
}

// Roll daily query/page rows up across the window. Clicks and impressions
// sum; position must NOT — it is an average rank, so it is re-weighted by
// impressions. Averaging the averages would let a query with one impression
// at rank 1 outrank one with a thousand impressions at rank 4.
export function rollupSearch(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    const slot = map.get(k) || { [key]: k, clicks: 0, impressions: 0, posWeighted: 0 };
    slot.clicks += r.clicks || 0;
    slot.impressions += r.impressions || 0;
    slot.posWeighted += (Number(r.position) || 0) * (r.impressions || 0);
    map.set(k, slot);
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      position: s.impressions > 0 ? s.posWeighted / s.impressions : 0,
      ctr: s.impressions > 0 ? s.clicks / s.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

// Search terms, both ad platforms, one row per day per term.
//
// Ordered by cost because the question the tab answers is "what are we paying
// for", and the tail is thousands of single-impression terms that cost
// nothing. The cap is deliberately generous: 3,400 Google terms and 900
// Amazon ones appear in a single month, so a low limit would silently hide
// the long tail rather than the noise.
// Google's BID keywords and landing pages. Separate tables because Google
// splits search terms, keywords and landing pages into different report views
// that cannot be combined in one request — see api/sync/google-detail.mjs.
//
// These read PostgREST directly, unlike search terms: migration 0025 creates
// their read policy in the same file that creates the tables, so they do not
// repeat the 0021 mistake that left ads_search_terms service-role-only.
// The Google detail tables were created with row-level security on and no
// read policy, so a direct PostgREST read answers an empty 200 — the Google
// Ads tab rendered "no data" over 1,791 rows. Same door as search terms: prove
// this session's token, then the endpoint reads with the service key.
async function viaGoogleDetail(table, days) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { rows: [], error: "Not signed in" };
    const res = await fetch(
      `/api/google-detail?table=${table}&days=${encodeURIComponent(days)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) return { rows: [], error: body?.error || `HTTP ${res.status}` };
    return { rows: body?.rows || [], error: null };
  } catch (err) {
    return { rows: [], error: err.message };
  }
}

export function fetchGoogleKeywords(days) {
  return cached("googleKeywords", { days }, () => viaGoogleDetail("keywords", days));
}

export function fetchGoogleLandingPages(days) {
  return cached("googleLandingPages", { days }, () => viaGoogleDetail("landing", days));
}

// Roll daily ad-detail rows up across the window on whichever key the section
// is grouped by. Everything summed here is a count or an amount, so a plain
// sum is correct. `extra` collects the secondary dimensions (campaign, ad
// group, match type) so a row can name them without a second query.
export function rollupAdRows(rows, keyFn, extraKeys = []) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!key) continue;
    const slot = map.get(key) || {
      key,
      impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0,
      extra: Object.fromEntries(extraKeys.map((k) => [k, new Set()])),
    };
    slot.impressions += r.impressions || 0;
    slot.clicks += r.clicks || 0;
    slot.cost += Number(r.cost) || 0;
    slot.sales += Number(r.sales ?? r.conversion_value) || 0;
    slot.orders += Number(r.orders ?? r.conversions) || 0;
    for (const k of extraKeys) if (r[k]) slot.extra[k].add(r[k]);
    map.set(key, slot);
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      extra: Object.fromEntries(Object.entries(s.extra).map(([k, v]) => [k, [...v]])),
      ctr: s.impressions > 0 ? s.clicks / s.impressions : 0,
      cpc: s.clicks > 0 ? s.cost / s.clicks : 0,
      // Only meaningful where the platform attributed something. A confident
      // 0.00x on a platform that reports no conversions at all would read as
      // a measured failure rather than an absent measurement.
      acos: s.sales > 0 ? s.cost / s.sales : null,
      roas: s.cost > 0 && s.sales > 0 ? s.sales / s.cost : null,
    }))
    .sort((a, b) => b.cost - a.cost);
}

// Search terms go through /api/search-terms rather than PostgREST: the
// table's "auth read" policy has never been created, so a direct read
// answers zero rows no matter how much data is there. The endpoint runs the
// identical query with the service key after verifying this session's token
// — same audience a policy would admit, different door. Everything else
// about the contract matches run(): a {rows, error} shape, never a throw.
export function fetchSearchTerms(days) {
  return cached("searchTerms", { days }, async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return { rows: [], error: "Not signed in" };
      // rollup=1: the endpoint sums each term across the window before
      // answering. The daily rows for even 7 days ran past 8,000 and the
      // browser was silently shown the top of the list, so every total here
      // understated. Coverage (first/last day per platform) comes back with it.
      const res = await fetch(`/api/search-terms?rollup=1&days=${encodeURIComponent(days)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { rows: [], error: body?.error || `HTTP ${res.status}` };
      return { rows: body?.rows || [], error: null, coverage: body?.coverage || {}, sourceRows: body?.source_rows || 0 };
    } catch (err) {
      return { rows: [], error: err.message };
    }
  });
}

// Roll daily term rows up across the window. Everything here is a count or an
// amount, so a plain sum is right — unlike Search Console's position, which
// has to be re-weighted.
//
// Keyed on the term AND the platform. The same words are bought on both
// platforms and merging them would add Amazon's 14-day click-attributed sales
// to whatever Google's tag counted, producing a number that means nothing.
export function rollupSearchTerms(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.platform}|${r.search_term}`;
    const slot = map.get(key) || {
      platform: r.platform,
      searchTerm: r.search_term,
      keywords: new Set(),
      campaigns: new Set(),
      matchTypes: new Set(),
      impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0,
    };
    if (r.keyword) slot.keywords.add(r.keyword);
    if (r.campaign_name) slot.campaigns.add(r.campaign_name);
    if (r.match_type) slot.matchTypes.add(r.match_type);
    slot.impressions += r.impressions || 0;
    slot.clicks += r.clicks || 0;
    slot.cost += Number(r.cost) || 0;
    slot.sales += Number(r.sales) || 0;
    slot.orders += Number(r.orders) || 0;
    slot.units += Number(r.units) || 0;
    map.set(key, slot);
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      keywords: [...s.keywords],
      campaigns: [...s.campaigns],
      matchTypes: [...s.matchTypes],
      ctr: s.impressions > 0 ? s.clicks / s.impressions : 0,
      cpc: s.clicks > 0 ? s.cost / s.clicks : 0,
      // ACOS and ROAS are only meaningful where the platform attributes sales
      // at all. Google currently reports zero conversions on every term, so
      // these stay null there rather than rendering a confident 0.00x.
      acos: s.sales > 0 ? s.cost / s.sales : null,
      roas: s.cost > 0 && s.sales > 0 ? s.sales / s.cost : null,
    }))
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks);
}

// GA4 acquisition. Deliberately kept alongside Shopify's own session data
// rather than replacing it: the two count sessions differently and disagree
// (425 against 510 over the same window), and hiding one behind the other
// would make that disagreement look like a data error later.
export function fetchGaChannels(days) {
  return cached("gaChannels", { days }, () =>
    run(
      supabase
        .from("ga_channels_daily")
        .select("date, channel_group, sessions, engaged_sessions, active_users, new_users, conversions, purchase_revenue")
        .gte("date", startDateFor(days))
        .order("date", { ascending: true }),
    ),
  );
}

export function fetchGaLandingPages(days) {
  return cached("gaPages", { days }, () =>
    run(
      supabase
        .from("ga_landing_pages_daily")
        .select("date, landing_page, sessions, engaged_sessions, conversions, purchase_revenue")
        .gte("date", startDateFor(days))
        .order("sessions", { ascending: false })
        .limit(2000),
    ),
  );
}

// Roll GA4 daily rows up across the window, summing every metric. Unlike
// Search Console there is no average-rank trap here — every GA4 field used
// is a count or a currency amount, so a plain sum is correct.
export function rollupGa(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    const s = map.get(k) || {
      [key]: k, sessions: 0, engaged: 0, users: 0, newUsers: 0, conversions: 0, revenue: 0,
    };
    s.sessions += r.sessions || 0;
    s.engaged += r.engaged_sessions || 0;
    s.users += r.active_users || 0;
    s.newUsers += r.new_users || 0;
    s.conversions += Number(r.conversions) || 0;
    s.revenue += Number(r.purchase_revenue) || 0;
    map.set(k, s);
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      engagementRate: s.sessions > 0 ? s.engaged / s.sessions : 0,
      cvr: s.sessions > 0 ? s.conversions / s.sessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

// Store-wide rates that are not per-SKU: payment processing and storage.
export function fetchStoreCosts() {
  return cached("storeCosts", {}, () =>
    run(supabase.from("store_costs").select("*").eq("id", "default")),
  );
}

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

// `shipping` and `taxes` arrive with migration 0022. Selecting a column that
// does not exist makes PostgREST reject the WHOLE query, so asking for them
// against a database that has not had the migration run does not lose the
// postage figures — it empties the Shopify tab and drops the storefront out
// of Overview's total revenue entirely. It did exactly that on the first
// deploy of this. So the columns are dropped and the query retried, which
// costs one wasted round trip once and nothing at all afterwards.
const SHOP_TOTALS_BASE = "date, gross_sales, discounts, refunds, net_sales, orders, units, currency";
const SHOP_TOTALS_NEW = "shipping, taxes";

export function fetchShopTotals(days) {
  return cached("shopTotals", { days }, async () => {
    const query = (cols) =>
      run(
        supabase
          .from("shop_totals_daily")
          .select(cols)
          .gte("date", startDateFor(days))
          .order("date", { ascending: true }),
      );
    const out = await query(`${SHOP_TOTALS_BASE}, ${SHOP_TOTALS_NEW}`);
    if (!out.error || !/shipping|taxes/.test(out.error)) return out;
    return query(SHOP_TOTALS_BASE);
  });
}

// ─── Shipping labels — postage actually bought ───────────────────────
// Day totals, because the export carries no order id and a label cannot be
// attributed to an order. Excluded shippers and approved refunds are stored
// with amount 0, so summing the column is already the right number and no
// caller has to remember the exclusion rule.
export function fetchShipLabels(days) {
  return cached("shipLabels", { days }, async () => {
    const read = (cols) => run(
      supabase
        .from("ship_labels")
        .select(cols)
        .gte("date_printed", startDateFor(days))
        .order("date_printed", { ascending: true }),
    );
    let out = await read("date_printed, amount, channel");
    // Before migration 0024 the channel COLUMN is missing, and PostgREST
    // rejects the whole query for it. That error also mentions ship_labels,
    // and the table-missing guard below was swallowing it as "no labels
    // imported" — while 195 labels worth $1,735.19 sat in the table and the
    // P&L showed a $742.76 estimate. Ask again without the column; every
    // label then counts as the storefront's, which postageByDay already
    // reports as unattributed.
    if (out.error && /column ship_labels\.channel/i.test(out.error)) {
      out = await read("date_printed, amount");
    }
    // A missing table (migration 0023 not run) is "no labels imported yet",
    // not an error worth breaking the dashboard over — the P&L falls back to
    // the estimate and says so.
    if (out.error && /ship_labels/.test(out.error)) return { rows: [], error: null };
    return out;
  });
}

// Postage per day, plus the range the import actually covers.
//
// The covered range matters as much as the total. A day inside it with no
// labels genuinely shipped nothing, and must cost zero; a day outside it was
// never imported, and has to fall back to the estimate. Without that
// distinction an import of last month would silently zero this month's
// shipping.
export function postageByDay(rows) {
  const byDay = new Map();
  // Split by channel as well as by day. The storefront charges the customer
  // for shipping and Amazon merchant-fulfilled orders do not, so one combined
  // postage line describes neither: it made the storefront look expensive to
  // ship for when it roughly pays for itself, and hid the unrecovered postage
  // on FBM, which is where the money actually goes.
  const byChannel = new Map();
  for (const r of rows) {
    const d = String(r.date_printed).slice(0, 10);
    const amt = Number(r.amount) || 0;
    byDay.set(d, (byDay.get(d) || 0) + amt);
    const c = r.channel || "storefront";
    byChannel.set(c, (byChannel.get(c) || 0) + amt);
  }
  const days = [...byDay.keys()].sort();
  const round = (n) => Math.round(n * 100) / 100;
  return {
    byDay,
    byChannel,
    amazonFbm: round(byChannel.get("amazon_fbm") || 0),
    storefront: round(byChannel.get("storefront") || 0),
    total: round([...byDay.values()].reduce((a, b) => a + b, 0)),
    from: days[0] || null,
    to: days[days.length - 1] || null,
    labels: rows.length,
    // Whether any label carries a channel at all. Before migration 0024 they
    // do not, and the P&L must say "not attributed" rather than silently
    // reporting every label as the storefront's.
    attributed: rows.some((r) => r.channel),
  };
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
// Pass a job to scope the history to it. Unscoped, this returns the newest
// 20 runs across ALL jobs — and the crons fire roughly 155 times a day, so
// 20 rows covers only the last few hours. A job that runs every six hours
// falls out of that window between runs, and syncStateFor then reports it as
// having never run: the Keywords badge read "Not synced" for most of every
// cycle while the sync was in fact healthy.
export function fetchSyncStatus(job = null) {
  return cached("sync", { job }, () => {
    let q = supabase
      .from("sync_runs")
      .select("job, status, rows_written, started_at, finished_at, detail");
    if (job) q = q.eq("job", job);
    return run(q.order("started_at", { ascending: false }).limit(20));
  });
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

// Store-wide totals. Sales come from the per-SKU rows; traffic comes from
// `trafficRows` (amz_traffic_daily), because per-SKU sessions are not a real
// figure — see fetchTraffic. Passing no traffic rows yields zero sessions,
// which is what a deploy landing before migration 0018 shows.
export function salesTotals(rows, trafficRows = []) {
  const t = rows.reduce(
    (acc, r) => {
      acc.revenue += Number(r.ordered_sales) || 0;
      acc.units += r.units_ordered || 0;
      acc.orderItems += r.order_items || 0;
      acc.refunds += r.units_refunded || 0;
      return acc;
    },
    { revenue: 0, units: 0, orderItems: 0, refunds: 0, sessions: 0, pageViews: 0 },
  );
  for (const r of trafficRows) {
    t.sessions += r.sessions || 0;
    t.pageViews += r.page_views || 0;
  }
  return t;
}

// ─── Shopify shaping ─────────────────────────────────────────────────

// `net` is product revenue. `revenue` is what the storefront actually took
// in — product plus the postage the customer paid for. They are kept apart
// because product net is the number that belongs beside COGS and beside
// Amazon's ordered-product sales, while revenue is the number that belongs
// in the P&L, which charges outbound postage as a cost.
//
// `taxes` is neither. It is collected for the state and remitted, so it is
// carried here only so deposits can be reconciled — never added to a top
// line. Migration 0022 added both columns; rows written before it read 0.
export function shopTotals(rows) {
  const t = rows.reduce(
    (acc, r) => {
      acc.gross += Number(r.gross_sales) || 0;
      acc.discounts += Number(r.discounts) || 0;
      acc.refunds += Number(r.refunds) || 0;
      acc.net += Number(r.net_sales) || 0;
      acc.shipping += Number(r.shipping) || 0;
      acc.taxes += Number(r.taxes) || 0;
      acc.orders += r.orders || 0;
      acc.units += r.units || 0;
      return acc;
    },
    { gross: 0, discounts: 0, refunds: 0, net: 0, shipping: 0, taxes: 0, orders: 0, units: 0 },
  );
  t.revenue = t.net + t.shipping;
  return t;
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
