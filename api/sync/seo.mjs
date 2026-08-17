// SEO sync — storefront sessions by source, plus Search Console.
//
// Separate from the Shopify sales sync on purpose: it uses a different
// Shopify surface (ShopifyQL analytics rather than the orders graph), needs
// a different scope (read_analytics), and answers a different question. A
// failure in one should not take the other down.
//
// Two sources answering two halves of the same question. Shopify says how
// many people arrived and roughly from where — every organic visit lands in
// one bucket called "search". Search Console says what they typed, where the
// listing ranked, and how often it was seen but not clicked. Neither can
// substitute for the other, and Search Console is the only one that can say
// WHY organic traffic moved.
//
// Search Console is optional. Until the property is authorised in Catchr the
// route still syncs Shopify and reports the gap in `notes`, rather than
// failing and taking the session data down with it.

import { sessionsBySource, isConfigured } from "../_lib/shopify.mjs";
import { query, toIsoDate, num, SEARCH_CONSOLE_FIELDS } from "../_lib/catchr.mjs";
import { SEARCH_CONSOLE_ACCOUNTS } from "../_lib/accounts.mjs";
import { upsert, startRun, finishRun } from "../_lib/db.mjs";
import { authorized, UNAUTHORIZED } from "../_lib/auth.mjs";
import { DATA_START } from "../../js/config.js";

// Search Console reports on a 2-3 day lag and restates recent days, so the
// window is always re-pulled rather than resumed from a cursor.
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

// One request per breakdown. Query and page are pulled separately rather
// than as a single (query, page) grid: crossing them multiplies the rows,
// and Search Console suppresses the long tail of the cross anyway, so the
// totals would silently stop matching either breakdown on its own.
async function syncSearchConsole(range) {
  const queryRows = [];
  const pageRows = [];
  const notes = [];

  if (!SEARCH_CONSOLE_ACCOUNTS.length) {
    notes.push(
      "search-console: not authorised in Catchr — no keyword or ranking data. " +
      "Connect it under Sources, then set CATCHR_SEARCH_CONSOLE_ACCOUNTS.",
    );
    return { queryRows, pageRows, notes };
  }

  const F = SEARCH_CONSOLE_FIELDS;
  const stamp = new Date().toISOString();

  for (const account of SEARCH_CONSOLE_ACCOUNTS) {
    const acct = [{ id: account.id, authorization_id: account.authorization_id }];

    for (const [dim, sink, key] of [[F.query, queryRows, "query"], [F.page, pageRows, "page_path"]]) {
      try {
        const result = await query("google-search-console", {
          accounts: acct,
          ...range,
          dimensions: [F.date, dim],
          metrics: F.metrics,
          sorts: [{ field: F.date, direction: "asc" }],
        });
        for (const r of result) {
          const date = toIsoDate(r[F.date]);
          const value = r[dim];
          if (!date || !value) continue;
          sink.push({
            date,
            site_url: account.id,
            [key]: String(value),
            clicks: num(r.clicks),
            impressions: num(r.impressions),
            // Average rank for the day. Stored as reported; any roll-up has
            // to weight it by impressions rather than averaging averages.
            position: num(r.position),
            synced_at: stamp,
          });
        }
        if (!result.length) notes.push(`search-console ${key}: no rows in window`);
      } catch (err) {
        notes.push(`search-console ${key}: ${err.message}`);
      }
    }
  }

  return { queryRows, pageRows, notes };
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json(UNAUTHORIZED);

  const url = new URL(req.url, "http://x");
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
  const dry = url.searchParams.get("dry") === "1";

  const runId = await startRun("seo");
  const notes = [];
  let written = 0;

  try {
    // Shopify sessions.
    let rows = [];
    const bySource = {};
    if (!isConfigured()) {
      notes.push("shopify: not configured — no session data");
    } else {
      rows = await sessionsBySource(days);
      // Upsert rather than replace: Shopify's analytics can restate a recent
      // day, and re-running must correct it without deleting older history
      // that has already aged out of the query window.
      if (!dry) written += await upsert("seo_sessions_daily", rows, "date,referrer_source");
      for (const r of rows) bySource[r.referrer_source] = (bySource[r.referrer_source] || 0) + r.sessions;
    }

    // Search Console.
    const sc = await syncSearchConsole(rangeFor(days));
    notes.push(...sc.notes);
    if (!dry) {
      try {
        written += await upsert("seo_queries_daily", sc.queryRows, "date,site_url,query");
        written += await upsert("seo_pages_daily", sc.pageRows, "date,site_url,page_path");
      } catch (err) {
        notes.push(`search-console write: ${err.message} — run migration 0019`);
      }
    }

    const summary = {
      ok: true, dry, days, written,
      counts: { sessions: rows.length, queries: sc.queryRows.length, pages: sc.pageRows.length },
      bySource, notes,
    };
    // Object form, not positional. This used to be finishRun(runId, "ok",
    // written, detail), which destructured the string — every SEO run
    // recorded rows_written 0 and a null detail no matter what it wrote.
    await finishRun(runId, {
      status: notes.length ? "partial" : "ok",
      rowsWritten: written,
      detail: summary,
    });
    return res.status(200).json(summary);
  } catch (err) {
    await finishRun(runId, { status: "error", rowsWritten: written, detail: { error: err.message, notes } });
    return res.status(200).json({ ok: false, error: err.message, notes });
  }
}
