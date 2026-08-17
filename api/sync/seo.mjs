// SEO sync — storefront sessions by acquisition source.
//
// Separate from the Shopify sales sync on purpose: it uses a different
// Shopify surface (ShopifyQL analytics rather than the orders graph), needs
// a different scope (read_analytics), and answers a different question. A
// failure in one should not take the other down.

import { sessionsBySource, isConfigured } from "../_lib/shopify.mjs";
import { upsert, startRun, finishRun } from "../_lib/db.mjs";
import { authorized, UNAUTHORIZED } from "../_lib/auth.mjs";

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json(UNAUTHORIZED);
  if (!isConfigured()) {
    return res.status(400).json({ ok: false, error: "Shopify is not configured" });
  }

  const url = new URL(req.url, "http://x");
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
  const dry = url.searchParams.get("dry") === "1";

  const runId = await startRun("seo");
  try {
    const rows = await sessionsBySource(days);
    // Upsert rather than replace: Shopify's analytics can restate a recent
    // day, and re-running must correct it without deleting older history
    // that has already aged out of the query window.
    const written = dry ? 0 : await upsert("seo_sessions_daily", rows, "date,referrer_source");

    const bySource = {};
    for (const r of rows) bySource[r.referrer_source] = (bySource[r.referrer_source] || 0) + r.sessions;

    const detail = { ok: true, dry, days, rows: rows.length, bySource };
    await finishRun(runId, "ok", written, detail);
    return res.status(200).json({ ok: true, dry, days, written, bySource });
  } catch (err) {
    await finishRun(runId, "error", 0, { error: err.message });
    return res.status(200).json({ ok: false, error: err.message });
  }
}
