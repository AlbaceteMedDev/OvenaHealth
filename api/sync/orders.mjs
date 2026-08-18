// Import Amazon's All Orders report into amz_orders, then derive
// amz_sales_daily from it.
//
//   GET  /api/sync/orders                 pull from SP-API and load
//   GET  /api/sync/orders?days=60         widen the window
//   GET  /api/sync/orders?reportId=...    resume a report already requested
//   GET  /api/sync/orders?dry=1           parse and report, write nothing
//   POST /api/sync/orders                 body is the report TSV itself
//
// WHY THIS EXISTS
// Migration 0018 moved Amazon sales off Catchr, whose connector overstated
// revenue by almost exactly 2x — 238 units against Amazon's real 125. It
// named /api/sync/orders as the replacement but the endpoint was never
// written, so amz_orders was loaded by hand once on 2026-08-17 and Amazon
// sales in the portal then stopped advancing entirely. Traffic kept
// refreshing every 30 minutes, which made the freeze look like a lag.
//
// WHY THERE ARE TWO INPUTS
// SP-API is the automated path and needs SPAPI_CLIENT_ID / _CLIENT_SECRET /
// _REFRESH_TOKEN. Until those exist the same loader accepts the report body
// on a POST, so a Seller Central export can be loaded without credentials
// and without a second code path to keep honest. Both feed one parser.

import {
  isConfigured as spapiConfigured,
  requestAllOrdersReport,
  waitForReport,
  MARKETPLACE_ID,
} from "../_lib/spapi.mjs";
import { upsert, select, deleteWhere, startRun, finishRun, loadSkuAliases } from "../_lib/db.mjs";
import { skuAliases as staticAliases, skuMap, asinMap } from "../../js/data/inventory.js";
import { DATA_START } from "../../js/config.js";
import { authorized, UNAUTHORIZED } from "../_lib/auth.mjs";

// Amazon reports in Pacific time and exports timestamps in UTC. Bucketing a
// UTC timestamp by its UTC date disagrees with Amazon on any day carrying an
// order after 5pm PT — 20 of 26 days when migration 0018 measured it. en-CA
// is the shortest route to a YYYY-MM-DD from Intl.
const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pacificDay(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : PACIFIC_DAY.format(d);
}

const money = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

// Column names differ between the report variants Amazon will hand you —
// quantity in particular. Resolve by trying each alias in order.
function columnResolver(header) {
  const cols = header.map((h) => h.trim().toLowerCase().replace(/^﻿/, ""));
  return (...aliases) => {
    for (const a of aliases) {
      const i = cols.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };
}

export function parseAllOrders(tsv, { marketplaceId = MARKETPLACE_ID } = {}) {
  const lines = String(tsv || "").split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return { rows: [], notes: ["Report was empty — no order rows"] };

  const header = lines[0].split("\t");
  const at = columnResolver(header);
  const notes = [];

  const iOrderId = at("amazon-order-id", "order-id");
  const iPurchase = at("purchase-date", "purchase-date-time");
  const iSku = at("sku", "seller-sku");
  const iQty = at("quantity", "quantity-purchased", "quantity-shipped");

  if (iOrderId === -1 || iPurchase === -1) {
    return {
      rows: [],
      notes: [
        `Unrecognised report: needs amazon-order-id and purchase-date, got [${header.slice(0, 12).join(", ")}]`,
      ],
    };
  }

  // GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL carries no
  // order-item-id, but amz_orders is keyed on one. Amazon merges repeats of a
  // SKU into a single line, so order id + SKU is unique in practice; the
  // occurrence counter is a backstop so a duplicate can never silently
  // overwrite the line before it.
  const iItemId = at("order-item-id");
  const seen = new Map();
  const synthesise = (orderId, sku) => {
    const base = `${orderId}::${sku || "-"}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}::${n}`;
  };
  if (iItemId === -1) {
    notes.push("Report has no order-item-id column — keying on amazon-order-id + sku");
  }

  const iStatus = at("order-status");
  const iChannel = at("fulfillment-channel");
  const iSales = at("sales-channel");
  const iShipLevel = at("ship-service-level");
  const iName = at("product-name");
  const iAsin = at("asin");
  const iCurrency = at("currency");
  const iPrice = at("item-price");
  const iTax = at("item-tax");
  const iShipPrice = at("shipping-price");
  const iShipTax = at("shipping-tax");
  const iItemPromo = at("item-promotion-discount");
  const iShipPromo = at("ship-promotion-discount");
  const iCity = at("ship-city");
  const iState = at("ship-state");
  const iPostal = at("ship-postal-code");
  const iCountry = at("ship-country");
  const iBusiness = at("is-business-order");
  const iPromoIds = at("promotion-ids");

  const cell = (parts, i) => (i === -1 ? null : (parts[i] ?? "").trim() || null);
  const stamp = new Date().toISOString();
  const rows = [];
  let undated = 0;

  for (let n = 1; n < lines.length; n += 1) {
    const p = lines[n].split("\t");
    const orderId = cell(p, iOrderId);
    const purchase = cell(p, iPurchase);
    if (!orderId || !purchase) continue;

    const day = pacificDay(purchase);
    if (!day) {
      undated += 1;
      continue;
    }

    const sku = cell(p, iSku);
    rows.push({
      order_item_id: cell(p, iItemId) || synthesise(orderId, sku),
      amazon_order_id: orderId,
      purchase_at: new Date(purchase).toISOString(),
      purchase_day: day,
      order_status: cell(p, iStatus) || "Unknown",
      fulfillment_channel: cell(p, iChannel),
      sales_channel: cell(p, iSales),
      ship_service_level: cell(p, iShipLevel),
      sku,
      asin: cell(p, iAsin),
      product_name: cell(p, iName),
      quantity: int(p[iQty]),
      currency: cell(p, iCurrency) || "USD",
      item_price: money(p[iPrice]),
      item_tax: money(p[iTax]),
      shipping_price: money(p[iShipPrice]),
      shipping_tax: money(p[iShipTax]),
      item_promo_discount: money(p[iItemPromo]),
      ship_promo_discount: money(p[iShipPromo]),
      ship_city: cell(p, iCity),
      ship_state: cell(p, iState),
      ship_postal_code: cell(p, iPostal),
      ship_country: cell(p, iCountry),
      is_business_order: /^(true|yes|1)$/i.test(cell(p, iBusiness) || ""),
      promotion_ids: cell(p, iPromoIds),
      synced_at: stamp,
    });
  }

  if (undated) notes.push(`${undated} row(s) had an unparseable purchase-date and were skipped`);
  if (iQty === -1) notes.push("No quantity column found — units will read 0");
  return { rows, notes, stamp, marketplaceId };
}

// Roll order items up into the per-day-per-SKU shape the Amazon tab reads.
//
// Cancelled orders are excluded: Amazon drops them from Ordered Product
// Sales, and leaving them in is how a cancelled $90 order keeps showing as
// revenue. They stay in amz_orders, which is the record of what happened.
//
// ordered_sales is the sum of item-price, which is already the line total
// excluding tax — the same basis as Sales & Traffic's orderedProductSales.
// Promotions are NOT netted off here; they are kept on the order rows so the
// margin work can apply them on its own basis.
//
// sessions and page_views are written as 0 on purpose. Migration 0018 marks
// those columns dead: per-SKU-per-day traffic is not obtainable from any
// source, and amz_traffic_daily holds the per-day figures instead.
export function deriveDailySales(orderRows, resolve, marketplaceId, stamp) {
  const byKey = new Map();

  for (const r of orderRows) {
    if (/^cancell?ed$/i.test(r.order_status || "")) continue;
    const amazonSku = r.sku;
    if (!amazonSku) continue;

    const key = `${r.purchase_day}|${amazonSku}`;
    const slot = byKey.get(key) || {
      date: r.purchase_day,
      marketplace_id: marketplaceId,
      amazon_sku: amazonSku,
      sku: resolve(amazonSku, r.asin),
      asin: r.asin || null,
      title: r.product_name || null,
      ordered_sales: 0,
      units_ordered: 0,
      order_items: 0,
      units_refunded: 0,
      sessions: 0,
      page_views: 0,
      currency: r.currency || "USD",
      synced_at: stamp,
    };
    slot.ordered_sales += r.item_price;
    slot.units_ordered += r.quantity;
    slot.order_items += 1;
    byKey.set(key, slot);
  }

  return [...byKey.values()].map((s) => ({
    ...s,
    ordered_sales: Math.round(s.ordered_sales * 100) / 100,
  }));
}

function makeResolver(dbAliases) {
  return function resolve(amazonSku, asin) {
    if (amazonSku && skuMap.has(amazonSku)) return amazonSku;
    const alias = dbAliases.get(amazonSku) || staticAliases.get(amazonSku);
    if (alias && skuMap.has(alias)) return alias;
    if (asin && asinMap.has(asin)) return asinMap.get(asin).sku;
    return null;
  };
}

function windowFor(days) {
  const end = new Date();
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - (Math.max(1, days) - 1));
  const startIso = start.toISOString().slice(0, 10);
  return {
    start: startIso < DATA_START ? DATA_START : startIso,
    end: end.toISOString().slice(0, 10),
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ error: UNAUTHORIZED });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const dry = url.searchParams.get("dry") === "1";
  const days = int(url.searchParams.get("days")) || 30;
  const resumeId = url.searchParams.get("reportId");
  const rebuild = url.searchParams.get("rebuild") === "1";
  const { start, end } = windowFor(days);

  // Where the TSV comes from: an upload beats SP-API, so a Seller Central
  // export can be loaded even once credentials exist.
  let tsv = null;
  let source = null;
  let preloaded = null;

  try {
    if (rebuild) {
      // No report at all — re-derive amz_sales_daily from the order items
      // already stored. This is the repair path: it needs no credentials and
      // no upload, and it is how a bad sales row gets corrected once the
      // underlying orders are known to be right.
      source = "amz_orders";
      preloaded = await select(
        "amz_orders",
        `select=purchase_day,sku,asin,product_name,quantity,item_price,currency,order_status&purchase_day=gte.${start}&limit=50000`,
      );
    } else if (req.method === "POST") {
      tsv = typeof req.body === "string" ? req.body : req.body?.toString?.() ?? "";
      source = "upload";
      if (!tsv.trim()) {
        res.status(400).json({
          ok: false,
          error:
            "POST body was empty. Send the All Orders report as text/plain — the TSV exactly as Amazon exports it.",
        });
        return;
      }
    } else if (spapiConfigured()) {
      source = "sp-api";
      const reportId = resumeId || (await requestAllOrdersReport({ start, end }));
      if (!reportId) {
        res.status(502).json({ ok: false, error: "SP-API did not return a reportId" });
        return;
      }
      const result = await waitForReport(reportId);
      if (!result.ready) {
        // Not a failure — Amazon is still building it. Handing the id back
        // beats holding the function open to its 300s ceiling.
        res.status(202).json({
          ok: false,
          pending: true,
          reportId,
          message: `Report still building. Retry with ?reportId=${reportId}`,
        });
        return;
      }
      tsv = result.text;
    } else {
      res.status(503).json({
        ok: false,
        error:
          "No source for the All Orders report. Either set SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET and SPAPI_REFRESH_TOKEN, or POST the report TSV to this endpoint.",
        howToUpload:
          "Seller Central > Reports > Fulfilment > All Orders, then: curl -X POST '<this url>?secret=…' --data-binary @orders.txt -H 'content-type: text/plain'",
      });
      return;
    }
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
    return;
  }

  const runId = dry ? null : await startRun("orders");

  try {
    const parsed = preloaded
      ? { rows: preloaded, notes: [`Re-derived from ${preloaded.length} stored order item(s)`] }
      : parseAllOrders(tsv);
    const { rows, notes } = parsed;
    const stamp = parsed.stamp || new Date().toISOString();
    const marketplaceId = parsed.marketplaceId || MARKETPLACE_ID;

    if (!rows.length) {
      const summary = { ok: true, dry, source, orderItems: 0, written: 0, notes };
      await finishRun(runId, { status: "partial", rowsWritten: 0, detail: summary });
      res.status(200).json(summary);
      return;
    }

    const coveredDays = [...new Set(rows.map((r) => r.purchase_day))].sort();
    const first = coveredDays[0];
    const last = coveredDays[coveredDays.length - 1];

    const resolve = makeResolver(await loadSkuAliases());
    const salesRows = deriveDailySales(rows, resolve, marketplaceId, stamp);
    const unresolved = salesRows.filter((r) => !r.sku).length;
    if (unresolved) {
      notes.push(`${unresolved} SKU(s) not in the catalog — add them to amazon_sku_map`);
    }

    let written = 0;
    if (!dry) {
      // Nothing new to store on a rebuild — the order items came FROM the table.
      if (!preloaded) written += await upsert("amz_orders", rows, "order_item_id");

      // Rebuild rather than upsert: the report is authoritative for the days
      // it covers, so a row left over from an earlier import is one Amazon no
      // longer reports and must not survive. Scoped to the covered days only,
      // never the whole table.
      await deleteWhere(
        "amz_sales_daily",
        `date=gte.${first}&date=lte.${last}&marketplace_id=eq.${encodeURIComponent(marketplaceId)}`,
      );
      written += await upsert("amz_sales_daily", salesRows, "date,marketplace_id,amazon_sku");
    }

    const summary = {
      ok: true,
      dry,
      source,
      window: { requested: { start, end }, covered: { first, last } },
      orderItems: rows.length,
      distinctOrders: new Set(rows.map((r) => r.amazon_order_id)).size,
      cancelled: rows.filter((r) => /^cancell?ed$/i.test(r.order_status || "")).length,
      salesRows: salesRows.length,
      units: salesRows.reduce((t, r) => t + r.units_ordered, 0),
      revenue: Math.round(salesRows.reduce((t, r) => t + r.ordered_sales, 0) * 100) / 100,
      written,
      notes,
    };

    await finishRun(runId, {
      status: notes.length ? "partial" : "ok",
      rowsWritten: written,
      detail: summary,
    });
    res.status(200).json(summary);
  } catch (err) {
    await finishRun(runId, { status: "error", detail: { error: err.message } });
    res.status(500).json({ ok: false, error: err.message });
  }
}
