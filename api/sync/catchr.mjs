// Pull Amazon Seller sales + all ad platforms from Catchr into Supabase.
//
// Runs on a Vercel cron (see vercel.json). Can also be hit manually:
//   GET /api/sync/catchr?days=90        backfill a longer window
//   GET /api/sync/catchr?dry=1          fetch and report, write nothing
//
// Protected by CRON_SECRET: Vercel cron sends it as a bearer token, and a
// human can pass ?secret=... . Without the env var set the route refuses to
// run rather than defaulting to open.

import {
  query,
  toIsoDate,
  num,
  SELLER_FIELDS,
  AMAZON_ADS_FIELDS,
  FACEBOOK_ADS_FIELDS,
  GOOGLE_ADS_FIELDS,
} from "../_lib/catchr.mjs";
import { upsert, startRun, finishRun, loadSkuAliases } from "../_lib/db.mjs";
import { SELLER_ACCOUNTS, AD_PLATFORMS, MERCHANT_CENTER_ACCOUNTS } from "../_lib/accounts.mjs";
import { skuAliases as staticAliases, skuMap, asinMap } from "../../js/data/inventory.js";
import { DATA_START } from "../../js/config.js";

// Every pull is an explicit CUSTOM range clamped to DATA_START. Catchr's
// relative ranges (LAST_28_DAYS and friends) would reach back past the
// reporting floor — LAST_28_DAYS already does — and the portal would then
// hold rows no tab is allowed to show.
function rangeFor(days) {
  const end = new Date();
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - (Math.max(1, days) - 1));

  const startIso = start.toISOString().slice(0, 10);
  return {
    date: "CUSTOM",
    start_date: startIso < DATA_START ? DATA_START : startIso,
    end_date: end.toISOString().slice(0, 10),
  };
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization || "";
  const url = new URL(req.url, "http://localhost");
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

// Resolve an Amazon seller SKU to a catalog SKU, preferring the live alias
// table, then the static map, then the ASIN.
function makeResolver(dbAliases) {
  return function resolve(amazonSku, asin) {
    if (amazonSku && skuMap.has(amazonSku)) return amazonSku;
    const alias = dbAliases.get(amazonSku) || staticAliases.get(amazonSku);
    if (alias && skuMap.has(alias)) return alias;
    if (asin && asinMap.has(asin)) return asinMap.get(asin).sku;
    return null;
  };
}

// Every date in [start, end] inclusive, as YYYY-MM-DD.
function eachDay(startIso, endIso) {
  const out = [];
  const d = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  let guard = 0;
  while (d <= end && guard < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

// ─── Amazon Seller: per-day, per-SKU sales + traffic ─────────────────
//
// WHY THIS LOOPS ONE DAY AT A TIME
// Catchr's amazon-seller connector cannot combine the date dimension with a
// product dimension. Ask for (date, sku) and it silently DROPS the date and
// returns window totals — no error, just rows with no date on them. An
// earlier version of this function requested (date, sku, asin, title) and
// would therefore have written nothing at all: every row failed the
// `if (!date)` guard below. Verified against the live connector 2026-08-12.
//
// So the only way to get true daily per-SKU rows is one request per day,
// with the date supplied by us rather than returned by the report.
async function syncSeller(range, resolve) {
  const rows = [];
  const notes = [];
  const days = eachDay(range.start_date, range.end_date);

  for (const account of SELLER_ACCOUNTS) {
    let unresolved = 0;

    for (const date of days) {
      let result;
      try {
        result = await query("amazon-seller", {
          accounts: [{ id: account.id, authorization_id: account.authorization_id }],
          date: "CUSTOM",
          start_date: date,
          end_date: date,
          dimensions: [SELLER_FIELDS.sku, SELLER_FIELDS.asin, SELLER_FIELDS.title],
          metrics: SELLER_FIELDS.metrics,
        });
      } catch (err) {
        // The connector times out intermittently. Skip the day rather than
        // failing the whole sync — the next run backfills it.
        notes.push(`${account.label} ${date}: ${err.message}`);
        continue;
      }

      for (const r of result) {
        const amazonSku = r[SELLER_FIELDS.sku];
        if (!amazonSku) continue;

        const asin = r[SELLER_FIELDS.asin] || null;
        const sku = resolve(amazonSku, asin);
        if (!sku) unresolved += 1;

        rows.push({
          date,
          marketplace_id: account.marketplace,
          amazon_sku: amazonSku,
          sku,
          asin,
          title: r[SELLER_FIELDS.title] || null,
          ordered_sales: num(r["sales.orderedProductSales.amount"]),
          units_ordered: num(r["sales.unitsOrdered"]),
          order_items: num(r["sales.totalOrderItems"]),
          units_refunded: num(r["sales.unitsRefunded"]),
          sessions: num(r["traffic.sessions"]),
          page_views: num(r["traffic.pageViews"]),
          unit_session_pct: num(r["traffic.unitSessionPercentage"]),
          buy_box_pct: num(r["traffic.buyBoxPercentage"]),
          currency: account.currency,
          synced_at: new Date().toISOString(),
          });
      }

      // One request per day adds up; pace them so the connector doesn't
      // start timing out mid-window.
      await new Promise((r) => setTimeout(r, 150));
    }

    if (unresolved) {
      notes.push(`${account.label}: ${unresolved} row(s) had a seller SKU not in the catalog — add it to amazon_sku_map`);
    }
  }

  return { rows, notes };
}

// ─── Ads: per-day, per-campaign, across every platform ───────────────
function adFieldsFor(platform) {
  if (platform === "amazon-ads") return AMAZON_ADS_FIELDS;
  if (platform === "facebook-ads") return FACEBOOK_ADS_FIELDS;
  return GOOGLE_ADS_FIELDS;
}

// Each platform names spend and attributed revenue differently. Normalise
// to one shape so the Ads tab can treat them uniformly.
function normaliseAdRow(platform, r) {
  if (platform === "amazon-ads") {
    return {
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      cost: num(r.cost),
      attributed_sales: num(r.sales14d),
      attributed_orders: num(r.purchases14d),
      attributed_units: num(r.attributedUnitsOrdered14d),
    };
  }
  if (platform === "facebook-ads") {
    return {
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      cost: num(r.spend),
      attributed_sales: num(r.purchase_value),
      attributed_orders: num(r.purchase),
      attributed_units: 0,
    };
  }
  return {
    impressions: num(r.Impressions),
    clicks: num(r.Clicks),
    cost: num(r.Cost),
    attributed_sales: num(r.ConversionValue),
    attributed_orders: num(r.Conversions),
    attributed_units: 0,
  };
}

async function syncAds(range, resolve) {
  const campaignRows = [];
  const skuRows = [];
  const notes = [];

  for (const { platform, accounts, perSku } of AD_PLATFORMS) {
    if (!accounts.length) {
      notes.push(`${platform}: not connected in Catchr — skipped`);
      continue;
    }
    const F = adFieldsFor(platform);

    for (const account of accounts) {
      const acct = [{ id: account.id, authorization_id: account.authorization_id }];

      // Campaign-level.
      try {
        const result = await query(platform, {
          accounts: acct,
          ...range,
          dimensions: [F.date, F.campaignId, F.campaignName],
          metrics: F.metrics,
          sorts: [{ field: F.date, direction: "asc" }],
        });
        if (!result.length) notes.push(`${platform} / ${account.label}: no rows in window`);

        for (const r of result) {
          const date = toIsoDate(r[F.date]);
          if (!date) continue;
          campaignRows.push({
            date,
            platform,
            account_id: account.id,
            account_name: account.label,
            campaign_id: String(r[F.campaignId] ?? ""),
            campaign_name: r[F.campaignName] || null,
            currency: account.currency,
            synced_at: new Date().toISOString(),
            ...normaliseAdRow(platform, r),
          });
        }
      } catch (err) {
        notes.push(`${platform} / ${account.label} campaigns: ${err.message}`);
      }

      // Per-SKU. Amazon Ads is the only platform that reports an advertised
      // SKU, which is what makes per-product TACOS possible. Meta and Google
      // drive traffic off-Amazon and cannot be attributed to a SKU without
      // Amazon Attribution tags.
      if (!perSku) continue;
      try {
        const result = await query(platform, {
          accounts: acct,
          ...range,
          dimensions: [F.date, F.sku, F.asin],
          metrics: ["impressions", "clicks", "cost", "sales14d", "purchases14d"],
          sorts: [{ field: F.date, direction: "asc" }],
        });
        for (const r of result) {
          const date = toIsoDate(r[F.date]);
          const amazonSku = r[F.sku];
          if (!date || !amazonSku) continue;
          const asin = r[F.asin] || null;
          skuRows.push({
            date,
            platform,
            account_id: account.id,
            amazon_sku: amazonSku,
            sku: resolve(amazonSku, asin),
            asin,
            impressions: num(r.impressions),
            clicks: num(r.clicks),
            cost: num(r.cost),
            attributed_sales: num(r.sales14d),
            attributed_orders: num(r.purchases14d),
            currency: account.currency,
            synced_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        notes.push(`${platform} / ${account.label} per-SKU: ${err.message}`);
      }
    }
  }

  return { campaignRows, skuRows, notes };
}

// ─── Google Merchant Center: feed health ─────────────────────────────
// Not a time series — a current snapshot of what can and can't serve.
async function syncMerchantCenter(range) {
  const issueRows = [];
  const productRows = [];
  const notes = [];
  const stamp = new Date().toISOString();

  for (const account of MERCHANT_CENTER_ACCOUNTS) {
    const acct = [{ id: account.id, authorization_id: account.authorization_id }];

    try {
      const issues = await query("google-merchant-center", {
        accounts: acct,
        ...range,
        dimensions: [
          "AccountStatusAccountLevelIssue.title",
          "AccountStatusAccountLevelIssue.severity",
          "AccountStatusAccountLevelIssue.documentation",
        ],
      });
      for (const r of issues) {
        const title = r["AccountStatusAccountLevelIssue.title"];
        if (!title) continue;
        issueRows.push({
          account_id: account.id,
          title,
          severity: r["AccountStatusAccountLevelIssue.severity"] || null,
          documentation: r["AccountStatusAccountLevelIssue.documentation"] || null,
          synced_at: stamp,
        });
      }
    } catch (err) {
      notes.push(`merchant-center account issues: ${err.message}`);
    }

    try {
      const products = await query("google-merchant-center", {
        accounts: acct,
        ...range,
        dimensions: [
          "product_view.title",
          "product_view.aggregated_destination_status",
          "product_view.availability",
        ],
      });
      for (const r of products) {
        const title = r["product_view.title"];
        if (!title) continue;
        productRows.push({
          account_id: account.id,
          product_title: title,
          destination_status: r["product_view.aggregated_destination_status"] || null,
          availability: r["product_view.availability"] || null,
          synced_at: stamp,
        });
      }
    } catch (err) {
      notes.push(`merchant-center product status: ${err.message}`);
    }
  }

  return { issueRows, productRows, notes };
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized. Set CRON_SECRET and pass it as a bearer token or ?secret=." });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const days = Number(url.searchParams.get("days") || 28);
  const dry = url.searchParams.get("dry") === "1";
  const range = rangeFor(days);

  const runId = dry ? null : await startRun("catchr");
  const notes = [];
  let written = 0;

  try {
    const dbAliases = await loadSkuAliases();
    const resolve = makeResolver(dbAliases);

    const seller = await syncSeller(range, resolve);
    notes.push(...seller.notes);

    const ads = await syncAds(range, resolve);
    notes.push(...ads.notes);

    const gmc = await syncMerchantCenter(range);
    notes.push(...gmc.notes);

    if (!dry) {
      written += await upsert("amz_sales_daily", seller.rows, "date,marketplace_id,amazon_sku");
      written += await upsert("ads_daily", ads.campaignRows, "date,platform,account_id,campaign_id");
      written += await upsert("ads_sku_daily", ads.skuRows, "date,platform,account_id,amazon_sku");
      written += await upsert("gmc_account_issues", gmc.issueRows, "account_id,title");
      written += await upsert("gmc_product_status", gmc.productRows, "account_id,product_title");
    }

    const summary = {
      ok: true,
      dry,
      range,
      written,
      counts: {
        seller: seller.rows.length,
        adCampaigns: ads.campaignRows.length,
        adSkus: ads.skuRows.length,
        gmcIssues: gmc.issueRows.length,
        gmcProducts: gmc.productRows.length,
      },
      notes,
    };
    await finishRun(runId, {
      status: notes.length ? "partial" : "ok",
      rowsWritten: written,
      detail: summary,
    });
    res.status(200).json(summary);
  } catch (err) {
    await finishRun(runId, { status: "error", rowsWritten: written, detail: { error: err.message, notes } });
    res.status(500).json({ ok: false, error: err.message, notes });
  }
}
