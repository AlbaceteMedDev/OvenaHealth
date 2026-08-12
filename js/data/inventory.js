// Catalog seed. Keep this in sync with the README catalog list.
//
// Two kinds of rows live here:
//
//   listed:   live on Amazon.com. `asin` is set, and these are the SKUs the
//             Sales / Products / Ads tabs report on, because Amazon is the
//             only channel with real order data flowing in.
//   stocked:  products we hold or produce but that have no Amazon listing
//             yet. They keep their inventory + COGS rows so warehouse counts
//             and margin math still work, but they never appear in Amazon
//             reporting.
//
// Seller SKUs that differ from the portal SKU (for example the separate FBA
// listing "CS-KHC-L-BLK-FBA" on the same ASIN) are folded in through the
// `amazon_sku_map` Supabase table, not here — see aliases below.

// ─── Live on Amazon.com ──────────────────────────────────────────────
const amazonListings = [
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
    sku: "CS-KHC-S-BLK",
    asin: "B0H8ZT6Y7B",
    product: "Compression Socks",
    category: "Compression",
    variant: "Knee High Closed Toe | S | Black",
    reorderLevel: 30,
    suggestedPrice: 22.49,
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
].map((row) => ({ ...row, listed: true, marketplace: "ATVPDKIKX0DER" }));

// ─── Stocked, not listed on Amazon ───────────────────────────────────
// The wound-care line. Artwork and IFUs live in the repo root; these ship
// through the warehouse today and have no ASIN yet.
const stockedOnly = [
  { sku: "CWD-2X2", product: "Collagen Wound Dressing", category: "Wound Care", variant: '2"x2"', reorderLevel: 80, suggestedPrice: 24.99 },
  { sku: "CWD-4X4", product: "Collagen Wound Dressing", category: "Wound Care", variant: '4"x4"', reorderLevel: 70, suggestedPrice: 39.99 },
  { sku: "CWD-7X7", product: "Collagen Wound Dressing", category: "Wound Care", variant: '7"x7"', reorderLevel: 60, suggestedPrice: 64.99 },
  { sku: "CWD-PWD", product: "Collagen Powder", category: "Wound Care", variant: "1 Gram", reorderLevel: 75, suggestedPrice: 34.99 },
  { sku: "GAUZE-ROLL", product: "Gauze Rolls", category: "Wound Care", variant: "Standard", reorderLevel: 100, suggestedPrice: 14.99 },
  { sku: "SFD-4X4", product: "Silicone Foam Dressing", category: "Wound Care", variant: '4"x4"', reorderLevel: 75, suggestedPrice: 34.99 },
  { sku: "SFD-6X6", product: "Silicone Foam Dressing", category: "Wound Care", variant: '6"x6"', reorderLevel: 70, suggestedPrice: 49.99 },
  { sku: "SFD-8X8", product: "Silicone Foam Dressing", category: "Wound Care", variant: '8"x8"', reorderLevel: 65, suggestedPrice: 69.99 },
  { sku: "GLOVE-DISP", product: "Disposable Gloves", category: "Supplies", variant: "Standard", reorderLevel: 200, suggestedPrice: 19.99 },
  { sku: "WOUND-WASH", product: "Wound Wash", category: "Supplies", variant: "Standard", reorderLevel: 90, suggestedPrice: 17.99 },
].map((row) => ({ ...row, asin: null, listed: false, marketplace: null }));

export const seedInventory = [...amazonListings, ...stockedOnly];

// Amazon seller SKUs that point at a catalog SKU we already track. The sync
// job also reads `amazon_sku_map` from Supabase; this covers the known cases
// so a fresh install resolves them without a round trip.
export const skuAliases = new Map([
  ["CS-KHC-L-BLK-FBA", "CS-KHC-L-BLK"],
]);

export const skuMap = new Map(seedInventory.map((row) => [row.sku, row]));

export const asinMap = new Map(
  amazonListings.map((row) => [row.asin, row]),
);

export const listedSkus = amazonListings.map((row) => row.sku);

// Resolve an Amazon seller SKU (or an alias) to a catalog row.
export function resolveSku(amazonSku) {
  if (!amazonSku) return null;
  const direct = skuMap.get(amazonSku);
  if (direct) return direct;
  const aliased = skuAliases.get(amazonSku);
  return aliased ? skuMap.get(aliased) || null : null;
}

export const marketplaces = [
  { id: "ATVPDKIKX0DER", name: "Amazon.com", country: "US", currency: "USD" },
  { id: "A2EUQ1WTGCTBG2", name: "Amazon.ca", country: "CA", currency: "CAD" },
  { id: "A1AM78C64UM0Y8", name: "Amazon.com.mx", country: "MX", currency: "MXN" },
  { id: "A2Q3Y263D00KWC", name: "Amazon.com.br", country: "BR", currency: "BRL" },
];
