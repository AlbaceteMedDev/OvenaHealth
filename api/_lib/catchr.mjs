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
//   CATCHR_QUERY_PATH  default /query/{platform}   ({platform} is substituted)
//   CATCHR_AUTH_STYLE  bearer (default) | x-api-key | api-key | query

const BASE = (process.env.CATCHR_API_BASE || "https://api.catchr.io").replace(/\/+$/, "");
const QUERY_PATH = process.env.CATCHR_QUERY_PATH || "/query/{platform}";
const AUTH_STYLE = process.env.CATCHR_AUTH_STYLE || "bearer";
const KEY = process.env.CATCHR_API_KEY;

const AUTH_STYLES = ["bearer", "x-api-key", "api-key", "query"];
const PATH_CANDIDATES = ["/query/{platform}", "/v1/query/{platform}", "/api/query/{platform}"];

export class CatchrError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = "CatchrError";
    this.status = status;
    this.body = body;
  }
}

function buildRequest(platform, body, { path = QUERY_PATH, authStyle = AUTH_STYLE } = {}) {
  const url = new URL(BASE + path.replace("{platform}", encodeURIComponent(platform)));
  const headers = { "content-type": "application/json", accept: "application/json" };

  switch (authStyle) {
    case "x-api-key":
      headers["x-api-key"] = KEY;
      break;
    case "api-key":
      headers["api-key"] = KEY;
      break;
    case "query":
      url.searchParams.set("api_key", KEY);
      break;
    case "bearer":
    default:
      headers.authorization = `Bearer ${KEY}`;
      break;
  }

  return { url: url.toString(), headers, body: JSON.stringify(body) };
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
  const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
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
