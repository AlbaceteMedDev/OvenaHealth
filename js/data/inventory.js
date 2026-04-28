// Catalog seed. Keep this in sync with the README catalog list.

const coreProducts = [
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
];

const sockVersions = [
  { code: "KHC", label: "Knee High Closed Toe" },
  { code: "KHO", label: "Knee High Open Toe" },
  { code: "THC", label: "Thigh High Closed Toe" },
  { code: "THO", label: "Thigh High Open Toe" },
];

const sizes = [1, 2, 3, 4, 5];
const colors = [
  { name: "Black", code: "BLK" },
  { name: "Beige", code: "BGE" },
];

function makeSockVariants() {
  const entries = [];
  for (const version of sockVersions) {
    for (const size of sizes) {
      for (const color of colors) {
        entries.push({
          sku: `CS-${version.code}-S${size}-${color.code}`,
          product: "Compression Socks",
          category: "Compression",
          variant: `${version.label} | Size ${size} | ${color.name}`,
          reorderLevel: 40,
          suggestedPrice: 32.99,
        });
      }
    }
  }
  return entries;
}

export const seedInventory = [...coreProducts, ...makeSockVariants()];

export const sockVersionDefinitions = [
  { name: "KHC", description: "Knee High Closed Toe — below-knee with enclosed toes." },
  { name: "KHO", description: "Knee High Open Toe — below-knee with an open toe." },
  { name: "THC", description: "Thigh High Closed Toe — thigh-length with enclosed toes." },
  { name: "THO", description: "Thigh High Open Toe — thigh-length with an open toe." },
];

export const skuMap = new Map(seedInventory.map((row) => [row.sku, row]));
