// Catchr API client.
//
// ─── Why this file is shaped the way it is ───────────────────────────
// Catchr does not publish its REST contract. The request body below mirrors
// exactly what Catchr's own MCP server sends (platform / accounts /
// dimensions / metrics / date / filters / sorts), which is the same
// underlying query engine, so the *body* is known-good. What is NOT
// confirmed from public docs is the endpoint path and the auth header
// style. Both are therefore env-configurable, and `probe()` below will
// tell you which combination your key actually wants — run
// /api/health?probe=1 once after setting CATCHR_API_KEY and pin the result.
//
//   CATCHR_API_KEY     (required) your Catchr API key
//   CATCHR_API_BASE    default https://api.catchr.io
//   CATCHR_QUERY_PATH  default /api/request
//   CATCHR_AUTH_STYLE  query (default, ?apikey=) | bearer | x-api-key | api-key

const BASE = (process.env.CATCHR_API_BASE || "https://api.catchr.io").replace(/\/+$/, "");
const QUERY_PATH = process.env.CATCHR_QUERY_PATH || "/api/request";
const AUTH_STYLE = process.env.CATCHR_AUTH_STYLE || "query";
const KEY = process.env.CATCHR_API_KEY;

const AUTH_STYLES = ["bearer", "x-api-key", "api-key", "query"];
const PATH_CANDIDATES = ["/api/request", "/query/{platform}", "/v1/query/{platform}"];

export class CatchrError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = "CatchrError";
    this.status = status;
    this.body = body;
  }
}

function buildRequest(platform, spec, { path = QUERY_PATH, authStyle = AUTH_STYLE } = {}) {
  const url = new URL(BASE + path.replace("{platform}", encodeURIComponent(platform)));

  // Catchr's REST API is GET /api/request with everything in the query
  // string. It is NOT the MCP's JSON-body shape, which is what this file
  // originally assumed — that assumption produced a 404 from the gateway on
  // every call for weeks, because /query/{platform} is not a route.
  //
  // Two encodings live side by side and both matter:
  //   metrics / dimensions  comma-separated strings
  //   accounts / filters    JSON arrays
  url.searchParams.set("format", "json");
  url.searchParams.set("platform", platform);
  url.searchParams.set("accounts", JSON.stringify(spec.accounts || []));
  url.searchParams.set("filters", JSON.stringify(spec.filters || []));
  if (spec.dimensions?.length) url.searchParams.set("dimensions", spec.dimensions.join(","));
  if (spec.metrics?.length) url.searchParams.set("metrics", spec.metrics.join(","));

  if (spec.date === "CUSTOM") {
    url.searchParams.set("date", "CUSTOM");
    if (spec.start_date) url.searchParams.set("start_date", spec.start_date);
    if (spec.end_date) url.searchParams.set("end_date", spec.end_date);
  } else if (spec.date) {
    url.searchParams.set("date", spec.date);
  }

  // Amazon Ads rejects any field set unless it is told which report the
  // fields belong to. Omitting it is what produced "invalid mapping".
  if (spec.options_report) url.searchParams.set("options_report", spec.options_report);

  const headers = { accept: "application/json" };
  switch (authStyle) {
    case "x-api-key": headers["x-api-key"] = KEY; break;
    case "api-key": headers["api-key"] = KEY; break;
    case "bearer": headers.authorization = `Bearer ${KEY}`; break;
    case "query":
    default: url.searchParams.set("apikey", KEY); break;
  }

  return { url: url.toString(), headers };
}

// Core query. `spec` matches the Catchr query shape:
//   { accounts, dimensions, metrics, date, start_date, end_date,
//     filters, sorts, max_rows, include_current_date }
export async function query(platform, spec, opts = {}) {
  if (!KEY) throw new CatchrError("CATCHR_API_KEY is not set");

  const body = {
    date: "LAST_30_DAYS",
    dimensions: [],
    metrics: [],
    filters: [],
    sorts: [],
    max_rows: 5000,
    ...spec,
  };

  const req = buildRequest(platform, body, opts);
  const res = await fetch(req.url, { method: "GET", headers: req.headers });
  const text = await res.text();

  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body — usually an HTML error page from a wrong path.
  }

  if (!res.ok) {
    const detail = parsed?.message || parsed?.error || text.slice(0, 400);
    throw new CatchrError(`Catchr ${platform} query failed (${res.status}): ${detail}`, {
      status: res.status,
      body: parsed ?? text.slice(0, 400),
    });
  }

  // Catchr returns { count, total_count, rows: [...] }. Be tolerant of a
  // bare array in case the REST shape differs from the MCP shape.
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.data)) return parsed.data;
  throw new CatchrError(`Catchr ${platform} returned no recognisable rows`, { body: parsed });
}

// Try every (path, authStyle) combination against a cheap query until one
// works. Returns the winning combination so it can be pinned in env vars.
export async function probe(platform, spec) {
  if (!KEY) return { ok: false, error: "CATCHR_API_KEY is not set" };
  const attempts = [];

  for (const path of PATH_CANDIDATES) {
    for (const authStyle of AUTH_STYLES) {
      try {
        const rows = await query(platform, { ...spec, max_rows: 1 }, { path, authStyle });
        return {
          ok: true,
          path,
          authStyle,
          sampleRows: rows.length,
          pin: {
            CATCHR_QUERY_PATH: path,
            CATCHR_AUTH_STYLE: authStyle,
          },
          attempts,
        };
      } catch (err) {
        attempts.push({ path, authStyle, status: err.status ?? null, error: err.message.slice(0, 200) });
      }
    }
  }
  return { ok: false, error: "No path/auth combination succeeded", attempts };
}

// ─── Field maps ──────────────────────────────────────────────────────
// Confirmed against Catchr's field catalogue for each platform.

export const SELLER_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  sku: "sales.sku",
  asin: "sales.childAsin",
  title: "sales.productTitle",
  metrics: [
    "sales.orderedProductSales.amount",
    "sales.unitsOrdered",
    "sales.totalOrderItems",
    "sales.unitsRefunded",
    "traffic.sessions",
    "traffic.pageViews",
    "traffic.unitSessionPercentage",
    "traffic.buyBoxPercentage",
  ],
};

// Search terms — the words customers actually typed, per platform.
//
// The two connectors do not accept the same shape, and the difference is not
// cosmetic:
//
// GOOGLE: date + Query and nothing else. Adding CampaignName, QueryMatchType
// or KeywordTextMatchingQuery makes Catchr reject the whole request with
// "invalid mapping" — Google's search-term view cannot be joined to the
// keyword or campaign views through this connector. Verified field by field
// on 2026-08-19. So Google rows carry a search term and metrics, no more.
//
// AMAZON: date + searchTerm + keyword + matchType + campaignName all
// together, plus real click-attributed sales. Needs options_report, like
// every other Amazon Ads request here.
//
// sales14d / purchases14d / unitsSoldClicks14d are Amazon's 14-day
// CLICK-attributed figures, matching sales14d already used for campaign
// ROAS elsewhere in this file. Google's Conversions/ConversionValue are
// whatever its own tag is configured to count. The two are not comparable
// and the tab must not add them together.
export const GOOGLE_SEARCH_TERM_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  query: "Query",
  metrics: ["Impressions", "Clicks", "Cost", "Conversions", "ConversionValue"],
};

export const AMAZON_SEARCH_TERM_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  searchTerm: "searchTerm",
  keyword: "keyword",
  matchType: "matchType",
  campaignName: "campaignName",
  metrics: [
    "impressions",
    "clicks",
    "cost",
    "sales14d",
    "purchases14d",
    "unitsSoldClicks14d",
  ],
};

// Amazon's All Orders report, order by order.
//
// READ THIS BEFORE ASSUMING IT IS THE 2x BUG AGAIN. Migration 0018 moved
// Amazon SALES off Catchr because the Sales & Traffic report silently drops
// the date dimension once a product dimension is added and returns window
// totals — 238 units against Amazon's real 125.
//
// This is a different report and a different failure mode, because there is
// no aggregation to corrupt. Every field here is a DIMENSION on the order
// endpoint: one row per order ITEM, carrying its own Amazon order id,
// purchase timestamp, SKU and quantity. Catchr sums nothing, so no window
// total can leak in. The rows are bucketed and totalled by exactly the same
// code that reads the SP-API TSV.
//
// Verified against Seller Central on 2026-08-19: 15 distinct orders on
// 2026-08-18 Pacific, matching what the account reported for that day.
//
// PurchaseDate arrives as compact UTC — "20260819041811" — not ISO.
export const SELLER_ORDER_FIELDS = {
  orderId: "order.AmazonOrderId",
  purchaseDate: "order.PurchaseDate",
  sku: "order.sku",
  asin: "order.asin",
  title: "order.ProductName",
  quantity: "order.quantity",
  status: "order.OrderStatus",
  channel: "order.FulfillmentChannel",
  salesChannel: "order.SalesChannel",
  shipLevel: "order.ShipServiceLevel",
  itemPrice: "order.OrderItemPrice",
  itemTax: "order.OrderItemTax",
  currency: "order.currency",
  shipCity: "order.OrderShipCity",
  shipState: "order.OrderShipState",
  shipPostal: "order.OrderShipPostalCode",
  shipCountry: "order.OrderShipCountry",
  isBusiness: "order.OrderIsBusinessOrder",
  promoIds: "order.OrderPromotionIds",
};

// Catchr timestamps on the order endpoint are compact UTC, "YYYYMMDDHHMMSS".
// new Date() cannot parse that form — it yields Invalid Date, which would
// silently drop every order row.
export function toIsoStamp(compact) {
  const s = String(compact ?? "").trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Google Search Console. The only source for what people actually typed:
// Shopify collapses every organic visit into one "search" bucket.
//
// `position` is an AVERAGE rank, not a count — it must never be summed.
// Rolling it up across days or rows means weighting by impressions, which
// is why impressions are always pulled alongside it.
export const SEARCH_CONSOLE_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  query: "search_query.query",
  page: "page.pagepath",
  site: "site.siteUrl",
  metrics: ["clicks", "impressions", "ctr", "position"],
};

// GA4. Reports the CHANNEL a visit arrived through, never the query behind
// it — organicGoogleSearch* exist in the schema but stay empty until a
// Search Console property is linked to the GA4 property.
//
// sessionDefaultChannelGroup, not defaultChannelGroup: the former attributes
// on the session that is being counted, the latter on the event, and mixing
// them double-counts a session whose events span channels.
export const GA_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  channel: "sessionDefaultChannelGroup",
  landingPage: "landingPagePlusQueryString",
  metrics: [
    "sessions",
    "engagedSessions",
    "activeUsers",
    "newUsers",
    "conversions",
    "purchaseRevenue",
  ],
};

export const AMAZON_ADS_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  campaignId: "campaignId",
  campaignName: "campaignName",
  sku: "advertisedSku",
  asin: "advertisedAsin",
  metrics: ["impressions", "clicks", "cost", "sales14d", "purchases14d"],
};

// Meta conversion metrics are addressed by their raw action-type keys, not
// friendly names. "purchase" and "purchase_value" do NOT exist and the API
// rejects the whole request with error 100 ("nonexisting summary field") —
// so a single wrong id fails the sync rather than returning partial data.
// Verified against the live connector 2026-08-12.
export const FACEBOOK_ADS_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  campaignId: "campaign_id",
  campaignName: "campaign_name",
  metrics: [
    "impressions",
    "clicks",
    "spend",
    "action_value_offsite_conversion.fb_pixel_purchase",
    "action_type_offsite_conversion.fb_pixel_purchase",
  ],
};

// Google Ads field ids are PascalCase in Catchr, not the GAQL
// "metrics.cost_micros" form. Verified against Catchr's field catalogue.
// Cost is already in account currency — no micros conversion needed.
export const GOOGLE_ADS_FIELDS = {
  date: "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY",
  campaignId: "CampaignId",
  campaignName: "CampaignName",
  metrics: ["Impressions", "Clicks", "Cost", "ConversionValue", "Conversions"],
};

// Catchr returns dates as "20260729". Postgres wants "2026-07-29".
export function toIsoDate(compact) {
  const s = String(compact ?? "");
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
