// Amazon Selling Partner API client — FBA inventory only.
//
// Catchr's amazon-seller connector exposes Sales, Traffic and Order fields
// but nothing about stock, so inventory has to come straight from Amazon.
//
// SP-API dropped the AWS SigV4 / IAM role requirement in 2023: a Login with
// Amazon (LWA) access token in the x-amz-access-token header is now
// sufficient. That's why this file needs no AWS SDK and no crypto — keeping
// the portal's zero-dependency, no-build-step property intact.
//
// Required env (Vercel → Settings → Environment Variables):
//   SPAPI_CLIENT_ID       LWA client id     (amzn1.application-oa2-client...)
//   SPAPI_CLIENT_SECRET   LWA client secret
//   SPAPI_REFRESH_TOKEN   LWA refresh token (Atzr|...)
//   SPAPI_REGION          na (default) | eu | fe
//   SPAPI_MARKETPLACE_ID  default ATVPDKIKX0DER (Amazon.com)

const REGION_HOSTS = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const REGION = process.env.SPAPI_REGION || "na";
const HOST = REGION_HOSTS[REGION] || REGION_HOSTS.na;
export const MARKETPLACE_ID = process.env.SPAPI_MARKETPLACE_ID || "ATVPDKIKX0DER";

export class SpApiError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = "SpApiError";
    this.status = status;
    this.body = body;
  }
}

export function isConfigured() {
  return Boolean(
    process.env.SPAPI_CLIENT_ID &&
      process.env.SPAPI_CLIENT_SECRET &&
      process.env.SPAPI_REFRESH_TOKEN,
  );
}

// Access tokens live an hour; a warm lambda can reuse one across invocations.
let cachedToken = null;
let cachedTokenExpiry = 0;

export async function accessToken() {
  if (!isConfigured()) throw new SpApiError("SP-API credentials are not set");
  if (cachedToken && Date.now() < cachedTokenExpiry - 60_000) return cachedToken;

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.SPAPI_REFRESH_TOKEN,
      client_id: process.env.SPAPI_CLIENT_ID,
      client_secret: process.env.SPAPI_CLIENT_SECRET,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new SpApiError(
      `LWA token exchange failed (${res.status}): ${body?.error_description || body?.error || "unknown"}`,
      { status: res.status, body },
    );
  }
  cachedToken = body.access_token;
  cachedTokenExpiry = Date.now() + (body.expires_in ?? 3600) * 1000;
  return cachedToken;
}

async function get(path, params, token) {
  const url = new URL(HOST + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { "x-amz-access-token": token, accept: "application/json" },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.errors?.[0]?.message || body?.message || `HTTP ${res.status}`;
    throw new SpApiError(`SP-API ${path} failed (${res.status}): ${detail}`, {
      status: res.status,
      body,
    });
  }
  return body;
}

// FBA Inventory Summaries, following nextToken to the end.
// Rate limit is 2 req/sec burst 2, so we pace between pages.
export async function fbaInventorySummaries({ marketplaceId = MARKETPLACE_ID } = {}) {
  const token = await accessToken();
  const summaries = [];
  let nextToken = null;
  let guard = 0;

  do {
    const body = await get(
      "/fba/inventory/v1/summaries",
      nextToken
        ? { nextToken, granularityType: "Marketplace", granularityId: marketplaceId, marketplaceIds: marketplaceId }
        : {
            details: "true",
            granularityType: "Marketplace",
            granularityId: marketplaceId,
            marketplaceIds: marketplaceId,
          },
      token,
    );

    summaries.push(...(body?.payload?.inventorySummaries || []));
    nextToken = body?.pagination?.nextToken || null;
    guard += 1;
    if (nextToken) await new Promise((r) => setTimeout(r, 600));
  } while (nextToken && guard < 50);

  return summaries;
}

// Flatten one SP-API summary into an fba_inventory row. `stamp` is shared by
// every row in a run so the snapshot prune can key off it exactly.
export function toInventoryRow(summary, marketplaceId, resolveSku, stamp) {
  const d = summary.inventoryDetails || {};
  const fulfillable = Number(summary.totalQuantity ?? 0);
  const inboundWorking = Number(d.inboundWorkingQuantity ?? 0);
  const inboundShipped = Number(d.inboundShippedQuantity ?? 0);
  const inboundReceiving = Number(d.inboundReceivingQuantity ?? 0);
  const reserved = Number(d.reservedQuantity?.totalReservedQuantity ?? 0);
  const unfulfillable = Number(d.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0);
  const researching = Number(d.researchingQuantity?.totalResearchingQuantity ?? 0);

  return {
    marketplace_id: marketplaceId,
    amazon_sku: summary.sellerSku,
    sku: resolveSku(summary.sellerSku, summary.asin),
    asin: summary.asin || null,
    fnsku: summary.fnSku || null,
    condition: summary.condition || null,
    fulfillable: Number(d.fulfillableQuantity ?? fulfillable),
    inbound_working: inboundWorking,
    inbound_shipped: inboundShipped,
    inbound_receiving: inboundReceiving,
    reserved,
    unfulfillable,
    researching,
    total: fulfillable + inboundWorking + inboundShipped + inboundReceiving,
    synced_at: stamp,
  };
}

// ─── Reports API ─────────────────────────────────────────────────────
// The All Orders report is the only order-item-level truth Amazon exposes,
// and it is what migration 0018 moved Amazon sales onto. Catchr cannot
// supply it: its connector is accurate per day OR per SKU but never both.
//
// Reports are asynchronous — request, poll, then download a document from a
// presigned URL that is usually gzipped. A cold request commonly takes a
// minute or two, which is why the caller is handed the reportId back and can
// resume polling on a later invocation instead of holding a function open.
export const ALL_ORDERS_REPORT = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";

async function post(path, body, token) {
  const res = await fetch(HOST + path, {
    method: "POST",
    headers: {
      "x-amz-access-token": token,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = parsed?.errors?.[0]?.message || parsed?.message || `HTTP ${res.status}`;
    throw new SpApiError(`SP-API ${path} failed (${res.status}): ${detail}`, {
      status: res.status,
      body: parsed,
    });
  }
  return parsed;
}

// Ask Amazon to build the report. Returns a reportId to poll.
export async function requestAllOrdersReport({ start, end, marketplaceId = MARKETPLACE_ID }) {
  const token = await accessToken();
  const body = await post(
    "/reports/2021-06-30/reports",
    {
      reportType: ALL_ORDERS_REPORT,
      marketplaceIds: [marketplaceId],
      dataStartTime: new Date(`${start}T00:00:00Z`).toISOString(),
      dataEndTime: new Date(`${end}T23:59:59Z`).toISOString(),
    },
    token,
  );
  return body?.reportId || null;
}

export async function reportStatus(reportId) {
  const token = await accessToken();
  return get(`/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, {}, token);
}

// Download and decompress a finished report document.
//
// The payload is TSV, gzipped more often than not. DecompressionStream is a
// platform API on Node 18+, so this stays dependency-free like the rest of
// the file. Amazon serves NA flat files as Cp1252 rather than UTF-8; the few
// bytes that differ are inside product names, which nothing keys on.
export async function fetchReportDocument(reportDocumentId) {
  const token = await accessToken();
  const doc = await get(
    `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
    {},
    token,
  );
  if (!doc?.url) throw new SpApiError("Report document had no download url", { body: doc });

  const res = await fetch(doc.url);
  if (!res.ok) throw new SpApiError(`Report document download failed (${res.status})`);

  if ((doc.compressionAlgorithm || "").toUpperCase() === "GZIP") {
    const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  return res.text();
}

// Poll until the report is ready or the deadline passes. Returns either the
// text, or the reportId so the caller can resume rather than fail.
export async function waitForReport(reportId, { deadlineMs = 120_000, intervalMs = 5_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    const status = await reportStatus(reportId);
    const state = status?.processingStatus;

    if (state === "DONE") {
      return { ready: true, text: await fetchReportDocument(status.reportDocumentId) };
    }
    // CANCELLED is Amazon's answer for "nothing matched", not a failure.
    if (state === "CANCELLED") return { ready: true, text: "" };
    if (state === "FATAL") {
      throw new SpApiError(`Report ${reportId} failed with FATAL`, { body: status });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ready: false, reportId };
}
