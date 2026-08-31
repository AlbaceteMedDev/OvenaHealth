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
import { upsert, replaceAll, startRun, finishRun } from "../_lib/db.mjs";
import { DATA_START, isExcludedProduct, REPORT_TZ } from "../../js/config.js";
import { authorized, UNAUTHORIZED } from "../_lib/auth.mjs";

// Columns migration 0022 adds.
const NEW_COLUMNS = ["shipping", "taxes"];

// Write the day totals, surviving a database that has not had migration 0022
// run against it yet.
//
// PostgREST rejects the WHOLE batch with PGRST204 if a single column is not
// in its schema cache, so pushing this code before the migration would not
// merely lose the postage figures — it would stop the Shopify sync writing
// anything at all, on a 30-minute cron, until someone noticed. Deploy order
// should not be able to break a working pipeline, so an unknown column is
// retried once without the new fields and reported. It heals itself on the
// first run after the migration lands.
//
// Returns { written, missing } rather than setting anything module-level: a
// warm lambda can serve two invocations, and a shared "which columns were
// missing" would be exactly the kind of state that reports one run's problem
// against another run's numbers.
async function writeTotals(write, rows, stamp) {
  const put = (r) => (stamp ? write("shop_totals_daily", r, "date", stamp)
                            : write("shop_totals_daily", r, "date"));
  try {
    return { written: await put(rows), missing: [] };
  } catch (err) {
    const text = `${err?.message || ""} ${err?.body || ""}`;
    // PostgREST names only the FIRST column it could not find, so retrying
    // with just that one stripped fails again on the next and the run dies
    // anyway — which is exactly what happened on the first deploy of this.
    // Either new column being absent means the migration has not run, so
    // both come out together and the retry converges.
    const named = NEW_COLUMNS.some((c) => text.includes(`'${c}'`) || text.includes(`"${c}"`));
    if (!named || !/PGRST204|schema cache|does not exist/i.test(text)) throw err;
    const trimmed = rows.map((r) => {
      const copy = { ...r };
      for (const c of NEW_COLUMNS) delete copy[c];
      return copy;
    });
    return { written: await put(trimmed), missing: [...NEW_COLUMNS] };
  }
}

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
    const { productRows, totalRows, excludedLines, renamedProducts } = shapeOrders(orders, {
      isExcluded: isExcludedProduct,
      timeZone: process.env.REPORT_TIMEZONE || REPORT_TZ,
    });

    // A full-window run re-reads EVERY day from the reporting floor, so what
    // it produces is the complete truth for the window — which makes it safe,
    // and necessary, to prune whatever it did not produce. Upserting alone
    // could only ever ADD or UPDATE, so a row the sync stopped producing
    // survived forever at its last value: the 2026-08-12 seed rows outlived
    // the Amazon filter that should have removed them, and re-bucketing days
    // from UTC to Eastern stranded a phantom copy of every evening order on
    // the following day. shop_sales_daily suffered worst, being keyed per
    // product rather than per day, so its stale siblings survived even on
    // days the totals table had fully corrected — which is exactly how
    // "revenue by product" came to exceed the daily net it should sum to.
    //
    // A NARROWED run (?since=) sees only part of the window, so pruning there
    // would delete real history that simply was not fetched. Those stay on a
    // plain upsert.
    const stamp = new Date().toISOString();
    for (const r of productRows) r.synced_at = stamp;
    for (const r of totalRows) r.synced_at = stamp;
    const fullWindow = since === DATA_START;

    let written = 0;
    let degraded = null;
    if (!dry) {
      const write = fullWindow ? replaceAll : upsert;
      written += fullWindow
        ? await replaceAll("shop_sales_daily", productRows, "date,product_title,variant_title", stamp)
        : await upsert("shop_sales_daily", productRows, "date,product_title,variant_title");
      const totals = await writeTotals(write, totalRows, fullWindow ? stamp : null);
      written += totals.written;
      if (totals.missing.length) {
        degraded = `shop_totals_daily has no ${totals.missing.join(" or ")} column yet — `
          + "run migration 0022. Postage is not being recorded.";
      }
    }

    const summary = {
      ok: true,
      dry,
      since,
      ordersFetched: orders.length,
      productRows: productRows.length,
      dayRows: totalRows.length,
      pruned: fullWindow,
      excludedLineItems: excludedLines,
      written,
      // What the storefront took in, so a run can be checked against
      // Shopify's own Analytics without opening the database.
      netSales: Math.round(totalRows.reduce((n, r) => n + r.net_sales, 0) * 100) / 100,
      shipping: Math.round(totalRows.reduce((n, r) => n + r.shipping, 0) * 100) / 100,
      taxes: Math.round(totalRows.reduce((n, r) => n + r.taxes, 0) * 100) / 100,
      // Excluding Juzo is designed behaviour, not degradation, and it fires on
      // every run that touches the pre-archive history. Counting it toward the
      // run status made shopify permanently "partial" — 224 of 247 runs — which
      // is what stopped "partial" from meaning anything on this dashboard.
      notes: [
        excludedLines
          ? `${excludedLines} line item(s) excluded by EXCLUDED_PRODUCT_PATTERNS (Juzo)`
          : null,
        // Also designed behaviour, but worth saying out loud: it means older
        // rows are being retitled, and anyone comparing this run's product
        // names against last week's export should know why they moved.
        renamedProducts
          ? `${renamedProducts} line item(s) retitled to their product's current name`
          : null,
      ].filter(Boolean),
      degraded,
      // Truncation IS degradation: those orders' revenue is understated.
      failures: orders.truncatedLineItems?.length
        ? [
            `${orders.truncatedLineItems.length} order(s) had more line items than one page: ${orders.truncatedLineItems.join(", ")}. Their revenue is understated — raise LINE_ITEM_PAGE_SIZE.`,
          ]
        : [],
    };
    await finishRun(runId, {
      // A missing column IS degradation — postage is going unrecorded — so it
      // counts toward the run status, unlike the Juzo exclusion above.
      status: (summary.failures.length || degraded) ? "partial" : "ok",
      rowsWritten: written,
      detail: summary,
    });
    res.status(200).json(summary);
  } catch (err) {
    await finishRun(runId, { status: "error", detail: { error: err.message } });
    res.status(500).json({ ok: false, error: err.message });
  }
}
