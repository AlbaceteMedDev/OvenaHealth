// Pull storefront sales from the Shopify Admin API into Supabase.
//
//   GET /api/sync/shopify           refresh from DATA_START
//   GET /api/sync/shopify?dry=1     fetch and report, write nothing
//
// Runs on a Vercel cron (see vercel.json). Guarded by CRON_SECRET.
//
// Always re-reads the whole window rather than only recent days: a refund
// issued today changes the net revenue of an order placed three weeks ago,
// and only a full re-read catches that.

import { fetchOrdersSince, shapeOrders, isConfigured } from "../_lib/shopify.mjs";
import { upsert, startRun, finishRun } from "../_lib/db.mjs";
import { DATA_START, isExcludedProduct, REPORT_TZ } from "../../js/config.js";
import { authorized, UNAUTHORIZED } from "../_lib/auth.mjs";

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ error: UNAUTHORIZED });
    return;
  }
  if (!isConfigured()) {
    res.status(503).json({
      ok: false,
      error:
        "Shopify is not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN (Admin API token with read_orders).",
    });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const dry = url.searchParams.get("dry") === "1";
  // `since` can move the window forward for a quick refresh, never back
  // past the reporting floor.
  const requested = url.searchParams.get("since");
  const since = requested && requested > DATA_START ? requested : DATA_START;

  const runId = dry ? null : await startRun("shopify");

  try {
    const orders = await fetchOrdersSince(since);
    const { productRows, totalRows, excludedLines } = shapeOrders(orders, {
      isExcluded: isExcludedProduct,
      timeZone: process.env.REPORT_TIMEZONE || REPORT_TZ,
    });

    let written = 0;
    if (!dry) {
      written += await upsert("shop_sales_daily", productRows, "date,product_title,variant_title");
      written += await upsert("shop_totals_daily", totalRows, "date");
    }

    const summary = {
      ok: true,
      dry,
      since,
      ordersFetched: orders.length,
      productRows: productRows.length,
      dayRows: totalRows.length,
      excludedLineItems: excludedLines,
      written,
      // Excluding Juzo is designed behaviour, not degradation, and it fires on
      // every run that touches the pre-archive history. Counting it toward the
      // run status made shopify permanently "partial" — 224 of 247 runs — which
      // is what stopped "partial" from meaning anything on this dashboard.
      notes: excludedLines
        ? [`${excludedLines} line item(s) excluded by EXCLUDED_PRODUCT_PATTERNS (Juzo)`]
        : [],
      // Truncation IS degradation: those orders' revenue is understated.
      failures: orders.truncatedLineItems?.length
        ? [
            `${orders.truncatedLineItems.length} order(s) had more line items than one page: ${orders.truncatedLineItems.join(", ")}. Their revenue is understated — raise LINE_ITEM_PAGE_SIZE.`,
          ]
        : [],
    };
    await finishRun(runId, {
      status: summary.failures.length ? "partial" : "ok",
      rowsWritten: written,
      detail: summary,
    });
    res.status(200).json(summary);
  } catch (err) {
    await finishRun(runId, { status: "error", detail: { error: err.message } });
    res.status(500).json({ ok: false, error: err.message });
  }
}
