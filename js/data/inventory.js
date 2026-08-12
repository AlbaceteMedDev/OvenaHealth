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
    sku: "CWD-PWD",
    asin: "B0H8N6Y5VW",
    product: "Collagen Wound Powder",
    category: "Wound Care",
    variant: "1 gram · 5 count",
    reorderLevel: 75,
    suggestedPrice: 13.59,
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
// Both still have live ASINs. The 7x7 dressing shows no buy-box price,
// and the S sock is no longer stocked. They stay here purely so historical
// orders resolve; they are hidden from Inventory by default.
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
  {
    sku: "CWD-7X7",
    asin: "B0HDCQ2LJF",
    product: "Collagen Wound Dressing",
    category: "Wound Care",
    variant: '7" x 7" · 5 count',
    reorderLevel: 0,
    suggestedPrice: 64.99,
  },
].map((row) => ({ ...row, listed: true, stocked: false, marketplace: "ATVPDKIKX0DER" }));

// ─── Warehouse only, never listed on Amazon ──────────────────────────
const warehouseOnly = [
  { sku: "GAUZE-ROLL", product: "Gauze Rolls", category: "Supplies", variant: "Standard", reorderLevel: 100, suggestedPrice: 14.99 },
  { sku: "SFD-4X4", product: "Silicone Foam Dressing", category: "Wound Care", variant: '4"x4"', reorderLevel: 75, suggestedPrice: 34.99 },
  { sku: "SFD-6X6", product: "Silicone Foam Dressing", category: "Wound Care", variant: '6"x6"', reorderLevel: 70, suggestedPrice: 49.99 },
  { sku: "SFD-8X8", product: "Silicone Foam Dressing", category: "Wound Care", variant: '8"x8"', reorderLevel: 65, suggestedPrice: 69.99 },
  { sku: "GLOVE-DISP", product: "Disposable Gloves", category: "Supplies", variant: "Standard", reorderLevel: 200, suggestedPrice: 19.99 },
  { sku: "WOUND-WASH", product: "Wound Wash", category: "Supplies", variant: "Standard", reorderLevel: 90, suggestedPrice: 17.99 },
].map((row) => ({ ...row, asin: null, listed: false, stocked: true, marketplace: null }));

export const seedInventory = [...stocked, ...retired, ...warehouseOnly];

// Amazon seller SKUs that point at a catalog SKU we already track. The sync
// job also reads `amazon_sku_map` from Supabase; this covers the known case
// so a fresh install resolves it without a round trip.
export const skuAliases = new Map([["CS-KHC-L-BLK-FBA", "CS-KHC-L-BLK"]]);

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

export const marketplaces = [
  { id: "ATVPDKIKX0DER", name: "Amazon.com", country: "US", currency: "USD" },
  { id: "A2EUQ1WTGCTBG2", name: "Amazon.ca", country: "CA", currency: "CAD" },
  { id: "A1AM78C64UM0Y8", name: "Amazon.com.mx", country: "MX", currency: "MXN" },
  { id: "A2Q3Y263D00KWC", name: "Amazon.com.br", country: "BR", currency: "BRL" },
];
