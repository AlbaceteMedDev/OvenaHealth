// Pull FBA stock levels from Amazon SP-API into Supabase.
//
//   GET /api/sync/fba            refresh the snapshot
//   GET /api/sync/fba?dry=1      fetch and report, write nothing
//
// Runs on a Vercel cron (see vercel.json). Guarded by CRON_SECRET.

import { fbaInventorySummaries, toInventoryRow, isConfigured, MARKETPLACE_ID } from "../_lib/spapi.mjs";
import { replaceAll, startRun, finishRun, loadSkuAliases } from "../_lib/db.mjs";
import { skuAliases as staticAliases, skuMap, asinMap } from "../../js/data/inventory.js";

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization || "";
  const url = new URL(req.url, "http://localhost");
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized. Set CRON_SECRET and pass it as a bearer token or ?secret=." });
    return;
  }
  if (!isConfigured()) {
    res.status(503).json({
      ok: false,
      error:
        "SP-API is not configured. Set SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET and SPAPI_REFRESH_TOKEN — see docs/SPAPI_SETUP.md.",
    });
    return;
  }

  const dry = new URL(req.url, "http://localhost").searchParams.get("dry") === "1";
  const runId = dry ? null : await startRun("fba");

  try {
    const dbAliases = await loadSkuAliases();
    const resolve = (amazonSku, asin) => {
      if (amazonSku && skuMap.has(amazonSku)) return amazonSku;
      const alias = dbAliases.get(amazonSku) || staticAliases.get(amazonSku);
      if (alias && skuMap.has(alias)) return alias;
      if (asin && asinMap.has(asin)) return asinMap.get(asin).sku;
      return null;
    };

    const summaries = await fbaInventorySummaries({ marketplaceId: MARKETPLACE_ID });
    // One stamp for the whole run — the prune deletes anything older, so
    // every row this sync writes has to carry the identical value.
    const stamp = new Date().toISOString();
    const rows = summaries.map((s) => toInventoryRow(s, MARKETPLACE_ID, resolve, stamp));
    const unresolved = rows.filter((r) => !r.sku).map((r) => r.amazon_sku);

    const written = dry ? 0 : await replaceAll("fba_inventory", rows, "marketplace_id,amazon_sku", stamp);

    const summary = {
      ok: true,
      dry,
      marketplace: MARKETPLACE_ID,
      fetched: rows.length,
      written,
      unresolvedSkus: unresolved,
      notes: unresolved.length
        ? [`${unresolved.length} seller SKU(s) not in the catalog — add them to amazon_sku_map: ${unresolved.join(", ")}`]
        : [],
    };
    await finishRun(runId, {
      status: unresolved.length ? "partial" : "ok",
      rowsWritten: written,
      detail: summary,
    });
    res.status(200).json(summary);
  } catch (err) {
    await finishRun(runId, { status: "error", detail: { error: err.message } });
    res.status(500).json({ ok: false, error: err.message });
  }
}
