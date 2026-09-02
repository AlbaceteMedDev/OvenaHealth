// Shopify Admin API client — storefront sales, net of refunds.
//
// Deliberately built on the `orders` query rather than ShopifyQL. ShopifyQL
// (`shopifyqlQuery`) is convenient but its availability has moved around
// between API versions, whereas `orders` + `lineItems` is stable and — more
// importantly — exposes `currentQuantity`, which is what makes refunds
// visible. A line item that was fully refunded keeps its original
// `quantity` but drops to `currentQuantity: 0`, so net revenue collapses to
// zero exactly as it should.
//
// Required env:
//   SHOPIFY_STORE_DOMAIN   e.g. c5s06e-3n.myshopify.com
//   SHOPIFY_API_VERSION    optional, default 2025-01
//
// Then EITHER a token that does not expire:
//   SHOPIFY_ADMIN_TOKEN    Admin API access token (shpat_…) with read_orders
// OR credentials this mints one from, which is the durable option:
//   SHOPIFY_CLIENT_ID      app client id
//   SHOPIFY_CLIENT_SECRET  app client secret (shpss_…)
//
// Why the second path exists: a token from the client_credentials grant is
// only valid for 24 hours. Pasting one into SHOPIFY_ADMIN_TOKEN works for a
// day and then returns 401 on every run forever after — which is exactly
// what this sync did. Holding the credentials and minting per run is the
// only arrangement that keeps working, and the mint is one request.

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const STATIC_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

// Cached across invocations that share a warm lambda. Re-minted a minute
// before expiry so a request can never start with a token that dies mid-flight.
let minted = null;   // { token, expiresAt }

// Precedence, and why it is this way round: when client credentials are set,
// MINT — a minted token renews itself. The static token is only used when
// there is nothing to mint with. It used to be the other way, and on Aug 31
// a 24-hour client_credentials token was pasted into SHOPIFY_ADMIN_TOKEN;
// it expired on schedule and every Shopify and SEO sync 401'd for a day
// while the credentials that could have minted a fresh one sat unused.
async function accessToken() {
  const canMint = !!(CLIENT_ID && CLIENT_SECRET);
  if (!canMint) {
    if (STATIC_TOKEN) return STATIC_TOKEN;
    throw new ShopifyError(
      "Set SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET to mint one",
    );
  }
  if (minted && Date.now() < minted.expiresAt - 60_000) return minted.token;

  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new ShopifyError(`Shopify token grant failed (${res.status}): ${body.slice(0, 200)}`, {
      status: res.status,
    });
  }
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  if (!parsed?.access_token) {
    throw new ShopifyError("Shopify token grant returned no access_token");
  }
  minted = {
    token: parsed.access_token,
    expiresAt: Date.now() + (Number(parsed.expires_in) || 3600) * 1000,
  };
  return minted.token;
}

export class ShopifyError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = "ShopifyError";
    this.status = status;
    this.body = body;
  }
}

export function isConfigured() {
  return Boolean(DOMAIN && (STATIC_TOKEN || (CLIENT_ID && CLIENT_SECRET)));
}

async function graphql(query, variables = {}) {
  if (!isConfigured()) {
    throw new ShopifyError("SHOPIFY_STORE_DOMAIN and a token or client credentials are not set");
  }
  let token = await accessToken();
  const call = (t) => fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": t,
    },
    body: JSON.stringify({ query, variables }),
  });
  let res = await call(token);
  // A 401 on a cached token means it is dead early — revoked, or the app was
  // reinstalled. Forget it and try exactly once more with a fresh mint.
  if (res.status === 401 && minted && CLIENT_ID && CLIENT_SECRET) {
    minted = null;
    token = await accessToken();
    res = await call(token);
  }

  // Read as text first: a throttled or errored Shopify response is not
  // always JSON, and `.json()` swallowing that would turn a diagnosable
  // failure into "cannot read properties of null".
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ShopifyError(
      `Shopify returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
      { status: res.status },
    );
  }

  if (!res.ok) {
    throw new ShopifyError(`Shopify Admin API failed (${res.status}): ${text.slice(0, 200)}`, {
      status: res.status,
      body,
    });
  }
  if (body?.errors?.length) {
    throw new ShopifyError(`Shopify GraphQL error: ${body.errors[0].message}`, { body: body.errors });
  }
  if (!body?.data) {
    throw new ShopifyError(`Shopify returned no data payload (${res.status})`, { body });
  }
  return body.data;
}

// ─── Page sizes are cost-bound, not taste ────────────────────────────
// Shopify rejects a query whose *requested* cost exceeds 1000 points,
// before it executes. Connections cost `2 + first x nodeCost`, and the
// nesting multiplies: each LineItem here is ~8 points (three MoneyBags at 2
// each, product at 1, the node itself at 1), and the order node now carries
// three MoneyBags of its own, so
//
//   orders(first:N) = 2 + N x (1 + 6 + 2 + N_line x 8)
//
// An earlier draft used first:50 / first:100, which prices at roughly
// 30,000 points — every single sync would have failed with
// MAX_COST_EXCEEDED. At 5 / 15 the request costs ~690, a comfortable
// margin under the cap even if Shopify's node accounting differs from the
// estimate above. Smaller pages just mean more round trips, and this store
// has fewer than a hundred orders in the reporting window. Measured against
// the live store on 2026-08-31 at these sizes: accepted, no throttle.
const ORDER_PAGE_SIZE = 5;
const LINE_ITEM_PAGE_SIZE = 15;

const ORDERS_QUERY = `
  query Orders($cursor: String, $q: String!, $orderPage: Int!, $linePage: Int!) {
    orders(first: $orderPage, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          cancelledAt
          currencyCode
          sourceName
          currentSubtotalPriceSet { shopMoney { amount } }
          currentTotalTaxSet { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          lineItems(first: $linePage) {
            pageInfo { hasNextPage }
            edges {
              node {
                title
                variantTitle
                quantity
                currentQuantity
                originalTotalSet { shopMoney { amount } }
                discountedTotalSet { shopMoney { amount } }
                discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
                product { id }
              }
            }
          }
        }
      }
    }
  }
`;

function money(node) {
  return Number(node?.shopMoney?.amount ?? 0) || 0;
}

// Pull every order created on or after `sinceIso` (YYYY-MM-DD).
// ─── Amazon orders must be excluded here ─────────────────────────────
// The store has Shopify's Amazon sales channel installed, so every Amazon
// order is ALSO imported into Shopify as an order with
// sourceName "amazon" / channel "amazon-us". Counting those as storefront
// revenue double-counts the entire Amazon business: measured 2026-08-12,
// six separate days had Shopify and Amazon daily totals identical to the
// cent, and only 6 of ~99 orders in the window were genuinely web orders.
//
// The filter belongs in the query string so the rows never arrive, and
// shapeOrders() also re-checks sourceName as a backstop in case the search
// syntax changes under us.
// The cheapest possible round trip that proves the token works. Used by
// /api/health?probe=shopify, because "configured" only means the variables
// are set — a token can be set and dead, and for a day on Sep 1 it was.
export async function shopName() {
  const data = await graphql(`{ shop { name myshopifyDomain } }`);
  return data?.shop || null;
}

export const NON_WEB_SOURCES = new Set(["amazon", "ebay", "walmart", "etsy"]);

export async function fetchOrdersSince(sinceIso) {
  const q = `created_at:>='${sinceIso}' AND NOT source_name:amazon`;
  const orders = [];
  const truncated = [];
  let cursor = null;
  let guard = 0;

  do {
    const data = await graphql(ORDERS_QUERY, {
      cursor,
      q,
      orderPage: ORDER_PAGE_SIZE,
      linePage: LINE_ITEM_PAGE_SIZE,
    });
    const conn = data?.orders;
    if (!conn) break;

    for (const edge of conn.edges) {
      const node = edge.node;
      // An order with more line items than one page holds would be counted
      // short. Surface it rather than silently under-reporting revenue.
      if (node.lineItems?.pageInfo?.hasNextPage) truncated.push(node.name || node.id);
      orders.push(node);
    }

    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    guard += 1;
    // Admin API is cost-throttled; a short pause keeps large backfills from
    // burning the leaky bucket.
    if (cursor) await new Promise((r) => setTimeout(r, 250));
  } while (cursor && guard < 500);

  if (cursor) {
    throw new ShopifyError(
      `Order pagination hit the ${guard}-page guard with more results pending. Narrow the window with ?since=.`,
    );
  }

  orders.truncatedLineItems = truncated;
  return orders;
}

// Collapse orders into per-day, per-product rows and per-day totals.
//
// `isExcluded(title)` drops line items we don't want counted anywhere —
// currently the discontinued Juzo listings. Excluded lines are removed
// before totals are computed, so an order containing only excluded items
// contributes nothing at all (not even to the order count, or its postage).
//
// ─── Three things this function used to get wrong ────────────────────
//
// 1. ORDER-LEVEL DISCOUNTS WERE INVISIBLE. `discountedTotalSet` stops at
//    line-level discounts; a discount applied to the ORDER is held in the
//    line's discountAllocations and never reaches that field. Order
//    #100110971000 — tagged "Collab Gift", 100% off, $0.00 collected —
//    was therefore booked as $37.98 of revenue, and #100111711000 was
//    booked $1.59 high. `discountedUnitPriceAfterAllDiscountsSet` is the
//    one field that has seen every discount, so net is computed from it.
//    It is a UNIT price, so it multiplies by quantity rather than being
//    scaled — which also retires the old currentQuantity/quantity ratio.
//
// 2. SHIPPING REVENUE WAS DROPPED ENTIRELY. Customers paid $195.86 of
//    postage over 2026-07-19..08-30 that appeared nowhere, while the P&L
//    charged outbound postage as a cost on every one of those orders. It
//    is NOT derived from totalShippingPriceSet, which ignores both refunds
//    and free-shipping discounts: that field says $8.00 for the Juzo order
//    whose shipping was discounted to nothing. The money actually still
//    owed for shipping is what is left of the order once product and tax
//    are taken out, and only the `current*` fields are net of refunds:
//
//      shipping = currentTotalPrice - currentSubtotalPrice - currentTotalTax
//
//    Checked against Shopify's own analytics on every all-storefront day in
//    the window (Aug 28/29/30: 17.71, 24.62, 17.53) — exact to the cent.
//
// 3. A RENAMED PRODUCT BECAME TWO PRODUCTS. shop_sales_daily is keyed on
//    the title, so when "Medical-Grade Hydrocolloid Roll, Cut-to-Size"
//    became "Hydrocolloid Roll, Cut-to-Size" its history split in half and
//    the top-products ranking put the store's best seller second. Rows are
//    now titled by the product's CURRENT name — resolved through the
//    Shopify product id, which does not change when the name does. Titles
//    with no product id (deleted products) keep their own name, since
//    there is nothing to resolve them to.
//
// Tax is recorded but is never revenue: it is collected on the state's
// behalf and remitted. It is stored so the storefront's deposits can be
// reconciled, not so anything can add it to a top line.
export function shapeOrders(orders, { isExcluded = () => false, timeZone = "UTC" } = {}) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Pass one: the current name of every product id. Orders arrive oldest
  // first, so the last title seen for an id is the newest one.
  const currentTitle = new Map();
  for (const order of orders) {
    if (order.cancelledAt) continue;
    for (const edge of order.lineItems?.edges || []) {
      const id = edge.node?.product?.id;
      if (id && edge.node.title) currentTitle.set(id, edge.node.title);
    }
  }

  const products = new Map();
  const totals = new Map();
  let excludedLines = 0;
  let marketplaceOrders = 0;
  let renamedProducts = 0;

  for (const order of orders) {
    if (order.cancelledAt) continue;
    // Backstop for the query-string filter: never let a marketplace order
    // be counted as storefront revenue.
    if (NON_WEB_SOURCES.has(String(order.sourceName || "").toLowerCase())) {
      marketplaceOrders += 1;
      continue;
    }

    const date = dayFmt.format(new Date(order.createdAt));
    const currency = order.currencyCode || "USD";

    let orderCounted = false;

    for (const edge of order.lineItems?.edges || []) {
      const li = edge.node;
      if (isExcluded(li.title)) {
        excludedLines += 1;
        continue;
      }

      const qty = Number(li.quantity) || 0;
      const netQty = Number(li.currentQuantity ?? qty) || 0;
      const gross = money(li.originalTotalSet);
      // After EVERY discount, order-level ones included. Falls back to the
      // line-level total if Shopify ever stops returning it, which restores
      // the old under-reporting of discounts rather than zeroing revenue.
      const unitAfterAll = li.discountedUnitPriceAfterAllDiscountsSet
        ? money(li.discountedUnitPriceAfterAllDiscountsSet)
        : (qty > 0 ? money(li.discountedTotalSet) / qty : 0);
      const discounted = unitAfterAll * qty;
      const net = unitAfterAll * netQty;

      const productId = li.product?.id || null;
      const title = (productId && currentTitle.get(productId)) || li.title || "";
      if (productId && li.title && title !== li.title) renamedProducts += 1;

      const key = `${date}|${title}|${li.variantTitle || ""}`;
      const slot = products.get(key) || {
        date,
        product_title: title,
        variant_title: li.variantTitle || "",
        product_id: productId,
        gross_sales: 0,
        discounts: 0,
        net_sales: 0,
        quantity: 0,
        net_quantity: 0,
        orders: 0,
        currency,
        _orderIds: new Set(),
      };
      slot.gross_sales += gross;
      slot.discounts += gross - discounted;
      slot.net_sales += net;
      slot.quantity += qty;
      slot.net_quantity += netQty;
      // Distinct orders, not line items. A two-variant order used to count
      // twice here, which is how "Collagen Kit" claimed three orders from
      // the two it was actually in.
      slot._orderIds.add(order.id || order.name);
      slot.orders = slot._orderIds.size;
      products.set(key, slot);

      const t = totals.get(date) || {
        date,
        gross_sales: 0,
        discounts: 0,
        refunds: 0,
        net_sales: 0,
        shipping: 0,
        taxes: 0,
        orders: 0,
        units: 0,
        currency,
      };
      t.gross_sales += gross;
      t.discounts += gross - discounted;
      t.net_sales += net;
      t.refunds += discounted - net;
      t.units += netQty;
      if (!orderCounted) {
        t.orders += 1;
        // Postage and tax belong to the order, not to any one line, so they
        // are added exactly once — and only for an order that survived the
        // exclusions, so a Juzo-only order brings no shipping with it.
        t.shipping += orderShipping(order);
        t.taxes += money(order.currentTotalTaxSet);
        orderCounted = true;
      }
      totals.set(date, t);
    }
  }

  const round = (n) => Math.round(n * 100) / 100;
  const stamp = new Date().toISOString();

  return {
    excludedLines,
    marketplaceOrders,
    renamedProducts,
    productRows: [...products.values()].map(({ _orderIds, ...r }) => ({
      ...r,
      gross_sales: round(r.gross_sales),
      discounts: round(r.discounts),
      net_sales: round(r.net_sales),
      synced_at: stamp,
    })),
    totalRows: [...totals.values()].map((r) => ({
      ...r,
      gross_sales: round(r.gross_sales),
      discounts: round(r.discounts),
      refunds: round(r.refunds),
      net_sales: round(r.net_sales),
      shipping: round(r.shipping),
      taxes: round(r.taxes),
      synced_at: stamp,
    })),
  };
}

// What the customer is still paying for postage, net of refunds and of any
// free-shipping discount. See note 2 on shapeOrders for why this is derived
// rather than read from totalShippingPriceSet. Clamped at zero: a
// shipping-only refund can briefly make the arithmetic negative, and a
// negative postage line would read as a cost rather than as a refund.
export function orderShipping(order) {
  const total = money(order.currentTotalPriceSet);
  const subtotal = money(order.currentSubtotalPriceSet);
  const tax = money(order.currentTotalTaxSet);
  return Math.max(0, Math.round((total - subtotal - tax) * 100) / 100);
}


// ─── Storefront traffic by acquisition source ────────────────────────
//
// Shopify exposes its own analytics through ShopifyQL, which needs
// read_analytics. The GraphQL shape is easy to get wrong and the errors are
// unhelpful, so for the record: shopifyqlQuery returns ShopifyqlQueryResponse
// — a plain object, not a union, so no `... on TableResponse` fragment.
// `parseErrors` is a String scalar and takes no selections. `tableData.rows`
// is JSON keyed by column name, NOT the `rowData` array the docs suggest.
//
// "search" is the organic number. Shopify reports it as one bucket with no
// engine or keyword breakdown — that only exists in Search Console.
export async function sessionsBySource(days = 30) {
  const q = `FROM sessions SHOW sessions GROUP BY day, referrer_source ` +
            `SINCE -${Math.max(1, Math.min(365, days))}d UNTIL today ORDER BY day ASC`;
  const data = await graphql(
    `query($q: String!) {
       shopifyqlQuery(query: $q) {
         parseErrors
         tableData { rows columns { name dataType } }
       }
     }`,
    { q },
  );
  const res = data?.shopifyqlQuery;
  const errs = res?.parseErrors;
  if (Array.isArray(errs) ? errs.length : errs) {
    throw new ShopifyError(`ShopifyQL parse error: ${JSON.stringify(errs).slice(0, 200)}`);
  }
  return (res?.tableData?.rows || []).map((r) => ({
    date: String(r.day).slice(0, 10),
    referrer_source: r.referrer_source || "unknown",
    sessions: Number(r.sessions) || 0,
  })).filter((r) => r.date && r.date !== "null");
}
