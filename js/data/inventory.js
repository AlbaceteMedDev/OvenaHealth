// Catalog seed. Keep this in sync with the README catalog list.
//
// Three kinds of rows live here:
//
//   stocked:   live on Amazon.com AND currently carried. These are what the
//              Inventory tab tracks and what reorder levels apply to.
//   retired:   still has an Amazon listing and historical sales, but is no
//              longer carried. Kept so past orders still resolve to a
//              product instead of showing as an unknown SKU — excluded from
//              inventory tracking and reorder alerts.
//   warehouse: held or produced but never listed on Amazon.
//
// ASINs and prices below were read off the live listings on 2026-08-12.
// The collagen line has listings with traffic but no sales yet, which is
// why it never appeared in the Sales & Traffic report.

// ─── Stocked and live on Amazon.com ──────────────────────────────────
const stocked = [
  {
    sku: "HC-ROLL5FT",
    asin: "B0H8ZH3J9R",
    product: "Hydrocolloid Roll",
    category: "Hydrocolloid",
    variant: '2" x 5 ft',
    reorderLevel: 120,
    suggestedPrice: 8.99,
  },
  {
    sku: "HC-ROLL16FT",
    asin: "B0H949P7JW",
    product: "Hydrocolloid Roll",
    category: "Hydrocolloid",
    variant: '2" x 16 ft',
    reorderLevel: 90,
    suggestedPrice: 14.39,
  },
  {
    sku: "CWD-2X2",
    asin: "B0HDCRM2WW",
    product: "Collagen Wound Dressing",
    category: "Wound Care",
    variant: '2" x 2" · 5 count',
    reorderLevel: 60,
    suggestedPrice: 32.99,
  },
  {
    sku: "CWD-4X4",
    asin: "B0HDCGJSK6",
    product: "Collagen Wound Dressing",
    category: "Wound Care",
    variant: '4" x 4" · 5 count',
    reorderLevel: 50,
    suggestedPrice: 55.0,
  },
  {
    // $13.59 was here until 2026-08-13. It is not this product's price — it
    // was picked up off a similar-items carousel tile (ASIN B08ZJ6BSCR) on
    // the listing page. B0H8N6Y5VW itself carries no buy-box price at all,
    // so there is no live number to read. $67.99 is the intended retail from
    // the first-order pricing workbook; against $22.60 COGS that is a 66.8%
    // margin, in line with the rest of the collagen line. Replace it with
    // the real figure once the listing is priced.
    sku: "CWD-PWD",
    asin: "B0H8N6Y5VW",
    product: "Collagen Wound Powder",
    category: "Wound Care",
    variant: "1 gram · 5 count",
    reorderLevel: 75,
    suggestedPrice: 67.99,
  },
  {
    sku: "CS-KHC-M-BLK",
    asin: "B0H8ZVQPPB",
    product: "Compression Socks",
    category: "Compression",
    variant: "Knee High Closed Toe | M | Black",
    reorderLevel: 45,
    suggestedPrice: 22.49,
  },
  {
    sku: "CS-KHC-L-BLK",
    asin: "B0H8ZJPGL8",
    product: "Compression Socks",
    category: "Compression",
    variant: "Knee High Closed Toe | L | Black",
    reorderLevel: 60,
    suggestedPrice: 22.49,
  },
  {
    sku: "CS-KHC-XL-BLK",
    asin: "B0H8ZQQB4F",
    product: "Compression Socks",
    category: "Compression",
    variant: "Knee High Closed Toe | XL | Black",
    reorderLevel: 40,
    suggestedPrice: 22.49,
  },
  {
    sku: "SOCK-AID",
    asin: "B0HC5X78B1",
    product: "Sock Aid Device",
    category: "Mobility",
    variant: "Flexible Sock Helper, 9.5 in",
    reorderLevel: 25,
    suggestedPrice: 14.99,
  },
].map((row) => ({ ...row, listed: true, stocked: true, marketplace: "ATVPDKIKX0DER" }));

// ─── Listed but no longer carried ────────────────────────────────────
// Still has a live ASIN, but the S sock is no longer stocked. It stays here
// purely so historical orders resolve; it is hidden from Inventory by
// default.
//
// CWD-7X7 (7" x 7" collagen dressing, ASIN B0HDCQ2LJF) was dropped from the
// catalog on 2026-08-13 — discontinued. It never sold a unit, so nothing
// historical depends on it. Its ASIN is recorded here so the row can be
// rebuilt if the size is ever brought back. Migration 0008 removes the
// matching inventory_state row.
const retired = [
  {
    sku: "CS-KHC-S-BLK",
    asin: "B0H8ZT6Y7B",
    product: "Compression Socks",
    category: "Compression",
    variant: "Knee High Closed Toe | S | Black",
    reorderLevel: 0,
    suggestedPrice: 22.49,
  },
].map((row) => ({ ...row, listed: true, stocked: false, marketplace: "ATVPDKIKX0DER" }));

// ─── Warehouse-only rows: removed 2026-08-13 ─────────────────────────
// The catalog is deliberately scoped to five product lines — compression
// socks, hydrocolloid rolls, sock aid, collagen powder, and the 2x2 / 4x4
// collagen dressings. Nothing else belongs in it.
//
// Dropped with that scoping: GAUZE-ROLL, SFD-4X4, SFD-6X6, SFD-8X8
// (silicone foam dressings — not the collagen 4x4), GLOVE-DISP and
// WOUND-WASH. None were ever listed on Amazon and none had a cost in any
// source document, so nothing measurable is lost. Migration 0008 removes
// their inventory_state rows.
//
// Collagen care kits are intentionally absent — not carried yet. Do not add
// a placeholder row for them; a SKU here with no stock and no cost drags
// COGS coverage down and shows up as a phantom in reorder alerts.

export const seedInventory = [...stocked, ...retired];

// Amazon seller SKUs that point at a catalog SKU we already track. The sync
// job also reads `amazon_sku_map` from Supabase; this covers the known case
// so a fresh install resolves it without a round trip.
// Confirmed against Seller Central on 2026-08-13: every seller SKU is the
// catalog SKU with a "-FBA" suffix, not just the L sock. Only that one was
// mapped before, so the other nine leaned entirely on the ASIN fallback in
// resolveSku() — fine while every report carries an ASIN, silently wrong the
// moment one doesn't. Derived rather than hand-listed so a new catalog row
// can't be added without its alias.
export const skuAliases = new Map(
  [...stocked, ...retired].map((row) => [`${row.sku}-FBA`, row.sku]),
);

export const skuMap = new Map(seedInventory.map((row) => [row.sku, row]));

export const asinMap = new Map(
  seedInventory.filter((r) => r.asin).map((row) => [row.asin, row]),
);

// Parent ASINs of variation families. Amazon reports sessions against these
// but never sales, so they must not be mistaken for missing products.
export const PARENT_ASINS = new Set(["B0H8M6CP76"]);

export const listedSkus = [...stocked, ...retired].map((r) => r.sku);
export const stockedSkus = stocked.map((r) => r.sku);

// Resolve an Amazon seller SKU (or an alias) to a catalog row.
export function resolveSku(amazonSku, asin) {
  if (!amazonSku && !asin) return null;
  const direct = skuMap.get(amazonSku);
  if (direct) return direct;
  const aliased = skuAliases.get(amazonSku);
  if (aliased && skuMap.has(aliased)) return skuMap.get(aliased);
  if (asin && asinMap.has(asin)) return asinMap.get(asin);
  return null;
}

// Resolve a Shopify line to a catalog SKU. Shopify reports a product title
// and a variant title, never a SKU, so the P&L had no way to charge COGS
// against storefront sales and simply left them uncosted — which made every
// margin on the Overview tab look better than it was.
//
// Matching is on normalised text: lowercased, curly quotes and the U+00D7
// multiplication sign folded to ASCII (the storefront emits BOTH "2 in x
// 5 ft" and "2 in × 5 ft" for the same variant), and runs of whitespace
// collapsed. Returns null for anything unrecognised — an unmatched line
// stays uncosted and is counted, rather than being charged a guessed rate.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[×✕✖]/g, "x")
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const SHOPIFY_PRODUCT_SKUS = [
  { product: "compression socks", variant: "xl", sku: "CS-KHC-XL-BLK" },
  { product: "compression socks", variant: "l", sku: "CS-KHC-L-BLK" },
  { product: "compression socks", variant: "m", sku: "CS-KHC-M-BLK" },
  { product: "compression socks", variant: "s", sku: "CS-KHC-S-BLK" },
  { product: "hydrocolloid roll", variant: "16 ft", sku: "HC-ROLL16FT" },
  { product: "hydrocolloid roll", variant: "5 ft", sku: "HC-ROLL5FT" },
  { product: "collagen wound dressing", variant: "4x4", sku: "CWD-4X4" },
  { product: "collagen wound dressing", variant: "2x2", sku: "CWD-2X2" },
  { product: "collagen wound powder", variant: null, sku: "CWD-PWD" },
  { product: "sock aid", variant: null, sku: "SOCK-AID" },
];

export function resolveShopifySku(productTitle, variantTitle) {
  const p = norm(productTitle);
  const v = norm(variantTitle);
  for (const rule of SHOPIFY_PRODUCT_SKUS) {
    if (!p.includes(rule.product)) continue;
    if (!rule.variant) return skuMap.has(rule.sku) ? rule.sku : null;
    // Size variants arrive as "L / 1 Pair" — match the size token on its own
    // so "L" cannot also match the "l" inside "XL".
    const tokens = v.split(/[^a-z0-9]+/).filter(Boolean);
    const hit = rule.variant.includes(" ")
      ? v.includes(rule.variant)
      : tokens.includes(rule.variant);
    if (hit) return skuMap.has(rule.sku) ? rule.sku : null;
  }
  return null;
}

export const marketplaces = [
  { id: "ATVPDKIKX0DER", name: "Amazon.com", country: "US", currency: "USD" },
  { id: "A2EUQ1WTGCTBG2", name: "Amazon.ca", country: "CA", currency: "CAD" },
  { id: "A1AM78C64UM0Y8", name: "Amazon.com.mx", country: "MX", currency: "MXN" },
  { id: "A2Q3Y263D00KWC", name: "Amazon.com.br", country: "BR", currency: "BRL" },
];
