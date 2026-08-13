// Plain-English definitions for every abbreviation the portal shows.
//
// Every acronym on screen gets a "?" next to it. Hover or focus it and the
// definition appears. The point is that nobody has to already know what
// TACOS means to read the dashboard — and that the definition sits next to
// the number rather than in a doc nobody opens.
//
// Definitions say what the number is AND how to read it, because "ad cost
// divided by sales" doesn't tell you whether 191% is good.

export const GLOSSARY = {
  ACOS: {
    term: "ACOS",
    full: "Advertising Cost of Sale",
    body:
      "Ad spend divided by the sales those ads are credited with. 25% means you spent $25 in ads " +
      "for every $100 of ad-attributed sales. Lower is better. Above 100% means the ads cost more " +
      "than the sales they generated — before you've paid for the product itself.",
  },
  TACOS: {
    term: "TACOS",
    full: "Total Advertising Cost of Sale",
    body:
      "Ad spend divided by TOTAL sales, not just ad-attributed ones. This is the honest one: it " +
      "counts the organic sales your ads help create. Falling TACOS at steady spend means organic " +
      "demand is building. Typically 5–15% for a healthy store.",
  },
  ROAS: {
    term: "ROAS",
    full: "Return On Ad Spend",
    body:
      "Sales credited to ads divided by ad spend — the reciprocal of ACOS. 4× means $4 back for " +
      "every $1 spent. Below 1× means the ads lose money outright.",
  },
  CTR: {
    term: "CTR",
    full: "Click-Through Rate",
    body:
      "Share of people who clicked after seeing the ad. Low CTR usually means the image, title or " +
      "price isn't competitive in the search results, not that the targeting is wrong.",
  },
  CPC: {
    term: "CPC",
    full: "Cost Per Click",
    body: "Average amount paid for one click. Set by auction, so it rises with competition on your keywords.",
  },
  CPA: {
    term: "CPA",
    full: "Cost Per Acquisition",
    body: "Ad spend divided by orders those ads produced — what one customer costs to buy.",
  },
  CVR: {
    term: "CVR",
    full: "Conversion Rate",
    body:
      "Share of visitors who bought. On Amazon this is units divided by sessions. A good listing " +
      "converts 10–15%; well below that usually points at price, reviews or images rather than traffic.",
  },
  AOV: {
    term: "AOV",
    full: "Average Order Value",
    body: "Revenue divided by number of orders — what a typical customer spends in one purchase.",
  },
  COGS: {
    term: "COGS",
    full: "Cost of Goods Sold",
    body:
      "What the product itself cost to buy, per unit sold. Here it's the supplier invoice price and " +
      "excludes freight, which is tracked separately as shipping.",
  },
  FBA: {
    term: "FBA",
    full: "Fulfilment by Amazon",
    body:
      "Amazon stores your stock and picks, packs and ships each order. You pay a per-unit fulfilment " +
      "fee for it, plus storage. Inventory sitting in FBA is not on your shelf.",
  },
  FNSKU: {
    term: "FNSKU",
    full: "Fulfilment Network Stock Keeping Unit",
    body: "Amazon's own barcode for your item inside FBA. Distinct from your seller SKU and from the ASIN.",
  },
  ASIN: {
    term: "ASIN",
    full: "Amazon Standard Identification Number",
    body: "Amazon's ten-character product ID. One ASIN per product page, shared by everyone selling that item.",
  },
  SKU: {
    term: "SKU",
    full: "Stock Keeping Unit",
    body:
      "Your internal code for one sellable variant. Amazon SKUs here carry a \"-FBA\" suffix; the " +
      "portal maps those back to the catalog SKU.",
  },
  "ORDERED PRODUCT SALES": {
    term: "Ordered product sales",
    full: "Ordered product sales",
    body:
      "The value of orders placed, before refunds and before Amazon's fees. It is NOT money received " +
      "— treat it as an upper bound. Amazon's fees and any refunds come out of it later.",
  },
  "NET SALES": {
    term: "Net sales",
    full: "Net sales",
    body:
      "Shopify's revenue after discounts and refunds. A product whose orders were all refunded shows " +
      "$0 net however large its gross was.",
  },
  SESSIONS: {
    term: "Sessions",
    full: "Sessions",
    body:
      "Visits to the product page, deduplicated per visitor per 24 hours. One person browsing three " +
      "times in a day is one session, so it approximates people rather than page loads.",
  },
  "CONTRIBUTION MARGIN": {
    term: "Contribution margin",
    full: "Contribution margin",
    body:
      "Revenue minus every cost that scales with a unit sold — COGS, shipping and Amazon's fees. " +
      "What each sale contributes toward fixed costs and advertising before either is paid.",
  },
  MER: {
    term: "MER",
    full: "Marketing Efficiency Ratio",
    body: "Total revenue divided by total ad spend across all channels. 3× means $3 of revenue per $1 of advertising.",
  },
};

// Look up loosely — callers pass "TACOS" or "tacos" or "Ordered product sales".
export function lookup(key) {
  if (!key) return null;
  return GLOSSARY[key] || GLOSSARY[String(key).toUpperCase()] || null;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// A "?" affordance carrying its own definition. Rendered as a <button> so it
// is reachable by keyboard and announced to screen readers, not a bare span
// that only works on hover.
export function hint(key) {
  const d = lookup(key);
  if (!d) return "";
  const label = `${d.full}. ${d.body}`;
  return (
    `<button type="button" class="gloss" aria-label="${esc(label)}" title="${esc(d.full)}">` +
    `<span aria-hidden="true">?</span>` +
    `<span class="gloss-pop" role="tooltip">` +
    `<strong>${esc(d.full)}</strong>${esc(d.body)}` +
    `</span></button>`
  );
}

// Label plus its "?" — the usual way widgets title a metric.
export function term(text, key = text) {
  return `${esc(text)}${hint(key)}`;
}
