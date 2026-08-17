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
import { authorized, UNAUTHORIZED } from "../_lib/auth.mjs";

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

// ─── Amazon Seller: per-day traffic only ─────────────────────────────
//
// THIS NO LONGER PRODUCES SALES. It used to, one day at a time, and every
// figure it wrote was wrong — 238 units against Amazon's real 125.
//
// Catchr's amazon-seller connector cannot combine the date dimension with a
// product dimension: ask for (date, sku) and it silently DROPS the date and
// returns window totals. The old workaround was to supply the date ourselves
// and request a single-day window per day. That looked reasonable and is
// quietly broken — the connector does not honour a one-day range once a
// product dimension is present, and returns inflated figures instead of an
// error. Measured against Amazon's All Orders report on 2026-08-17:
//
//   date dimension, full window  -> 125 units, matches Amazon 26/26 days
//   sku  dimension, full window  -> 120 units, matches Amazon per SKU
//   sku  dimension, single day   ->  17 units on 8/9 where Amazon says 4
//   traffic on those same rows   -> 2,073 sessions against a true 1,392
//
// Cumulative differencing was tested as a rescue and also fails: historical
// windows come back stale, so cum(D) - cum(D-1) collapses to near zero.
// There is no request shape that yields trustworthy per-SKU DAILY sales.
//
// So sales come from Amazon's All Orders report via /api/sync/orders, and
// this function keeps only what the connector reports accurately: per-day
// traffic, requested with the date dimension ALONE and no product dimension.
// One request instead of one per day, which also retires the resumable
// day-walking machinery and its 270-second deadline.
async function syncSeller(range) {
  const rows = [];
  const notes = [];

  for (const account of SELLER_ACCOUNTS) {
    let result;
    try {
      result = await query("amazon-seller", {
        accounts: [{ id: account.id, authorization_id: account.authorization_id }],
        ...range,
        // No product dimension. Adding one here is what broke this before:
        // it drops the date and inflates every metric.
        dimensions: [SELLER_FIELDS.date],
        metrics: SELLER_FIELDS.metrics,
      });
    } catch (err) {
      notes.push(`${account.label} traffic: ${err.message}`);
      continue;
    }

    for (const r of result) {
      const date = toIsoDate(r[SELLER_FIELDS.date]);
      if (!date) continue;
      rows.push({
        date,
        marketplace_id: account.marketplace,
        sessions: num(r["traffic.sessions"]),
        page_views: num(r["traffic.pageViews"]),
        // Kept as a cross-check against amz_orders, not as the sales figure
        // anything reports on. If these drift apart, the order import is
        // stale — which is the failure this table exists to make visible.
        units_ordered: num(r["sales.unitsOrdered"]),
        ordered_sales: num(r["sales.orderedProductSales.amount"]),
        synced_at: new Date().toISOString(),
      });
    }
    if (!result.length) notes.push(`${account.label}: no traffic rows in window`);
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
      // Keyed by the same raw action-type ids requested in FACEBOOK_ADS_FIELDS.
      attributed_sales: num(r["action_value_offsite_conversion.fb_pixel_purchase"]),
      attributed_orders: num(r["action_type_offsite_conversion.fb_pixel_purchase"]),
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
          // Required for amazon-ads: without it Catchr rejects the whole
          // field set as an "invalid mapping" rather than ignoring it.
          ...(platform === "amazon-ads" ? { options_report: "SPONSORED_PRODUCTS" } : {}),
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
          options_report: "SPONSORED_PRODUCTS",
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
    res.status(401).json({ error: UNAUTHORIZED });
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

    const seller = await syncSeller(range);
    notes.push(...seller.notes);

    const ads = await syncAds(range, resolve);
    notes.push(...ads.notes);

    const gmc = await syncMerchantCenter(range);
    notes.push(...gmc.notes);

    if (!dry) {
      // Traffic only. amz_sales_daily is written by /api/sync/orders from
      // Amazon's own order report — never from here. See migration 0018.
      try {
        written += await upsert("amz_traffic_daily", seller.rows, "date,marketplace_id");
      } catch (err) {
        notes.push(
          `amz_traffic_daily: ${err.message} — run migration 0018, then traffic charts fill in`,
        );
      }
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
        sellerTraffic: seller.rows.length,
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
