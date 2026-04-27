// Deterministic mock orders for the last 90 days. Seeded so reloads are stable.
// Each order is stored in UTC; the UI groups/displays in the user's timezone.

import { seedInventory } from "./inventory.js";

const DAYS = 90;
const SEED = 0xfeed42;

// Mulberry32 — small deterministic PRNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function pickWeighted(rand, items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

function skuWeight(row) {
  if (row.category === "Compression") {
    const base = 6;
    const sizeBoost = row.variant.includes("Size 2") || row.variant.includes("Size 3") ? 2 : 0;
    const colorBoost = row.variant.includes("Black") ? 1 : 0;
    const versionBoost = row.variant.includes("Knee High Closed") ? 1.5 : 0;
    return base + sizeBoost + colorBoost + versionBoost;
  }
  if (row.sku === "WOUND-WASH" || row.sku === "GLOVE-DISP") return 5;
  if (row.sku === "GAUZE-ROLL") return 4;
  if (row.category === "Wound Care") return 3.5;
  return 2;
}

const channels = [
  { value: "shopify", weight: 0.58 },
  { value: "amazon", weight: 0.42 },
];

function dailyOrderCount(rand, dayIndex) {
  // Slight upward trend, weekend dip. dayIndex 0 = oldest, DAYS-1 = today.
  const trend = 18 + (dayIndex / DAYS) * 14;
  const date = new Date(Date.now() - (DAYS - 1 - dayIndex) * 86400000);
  const dow = date.getUTCDay();
  const weekendDip = dow === 0 || dow === 6 ? 0.55 : 1;
  const noise = 0.7 + rand() * 0.7;
  return Math.max(2, Math.round(trend * weekendDip * noise));
}

function buildOrders() {
  const rand = mulberry32(SEED);
  const skuPool = seedInventory.map((row) => ({ value: row, weight: skuWeight(row) }));
  const channelPool = channels.map((c) => ({ value: c.value, weight: c.weight * 100 }));
  const orders = [];
  let orderSeq = 1000;

  const now = Date.now();
  const startOfDayUtc = (offset) => {
    const d = new Date(now - offset * 86400000);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  };

  for (let d = 0; d < DAYS; d++) {
    const dayStartMs = startOfDayUtc(DAYS - 1 - d);
    const count = dailyOrderCount(rand, d);
    for (let i = 0; i < count; i++) {
      const offsetMs = Math.floor(rand() * 86400000);
      const ts = new Date(dayStartMs + offsetMs).toISOString();
      const sku = pickWeighted(rand, skuPool);
      const channel = pickWeighted(rand, channelPool);
      const qty = pickWeighted(rand, [
        { value: 1, weight: 70 },
        { value: 2, weight: 22 },
        { value: 3, weight: 6 },
        { value: 4, weight: 2 },
      ]);
      const discountPct = pickWeighted(rand, [
        { value: 0, weight: 75 },
        { value: 0.05, weight: 12 },
        { value: 0.1, weight: 9 },
        { value: 0.15, weight: 4 },
      ]);
      const unitPrice = +(sku.suggestedPrice * (1 - discountPct)).toFixed(2);
      orders.push({
        id: `OV-${orderSeq++}`,
        ts,
        channel,
        sku: sku.sku,
        product: sku.product,
        category: sku.category,
        variant: sku.variant,
        qty,
        unitPrice,
        revenue: +(unitPrice * qty).toFixed(2),
      });
    }
  }
  orders.sort((a, b) => a.ts.localeCompare(b.ts));
  return orders;
}

export const mockOrders = buildOrders();
