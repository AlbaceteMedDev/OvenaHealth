// What shapeOrders() makes of a real day's storefront orders.
//
// Run: node test/shopify-shape.test.mjs
//
// No framework on purpose, same as placement.test.mjs — the portal has no
// build step and no dependencies, and this has to run with bare node.
//
// THE FIXTURE IS REAL. fixtures/shopify-orders-2026-07-19.json is every
// non-Amazon order the live store had between 2026-07-19 and 2026-08-31,
// pulled from the Admin API on 2026-08-31 in exactly the shape ORDERS_QUERY
// returns. Every expected number below was checked against Shopify's own
// Analytics, not against what this code happens to produce — which is the
// only way a test like this is worth anything.
//
// It exists because this pipeline has now been wrong in five separate ways
// (UTC day buckets, Amazon-channel double counting, un-pruned stale rows,
// order-level discounts, missing postage) and every one of them looked like
// a working sync from the outside: green run, rows written, plausible total.

import { shapeOrders, orderShipping } from "../api/_lib/shopify.mjs";
import { isExcludedProduct } from "../js/config.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const orders = JSON.parse(
  readFileSync(join(HERE, "fixtures", "shopify-orders-2026-07-19.json"), "utf8"),
);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) =>
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const shaped = shapeOrders(orders, {
  isExcluded: isExcludedProduct,
  timeZone: "America/New_York",
});
const { productRows, totalRows } = shaped;
const sum = (rows, k) => Math.round(rows.reduce((n, r) => n + (r[k] || 0), 0) * 100) / 100;
const day = (d) => totalRows.find((r) => r.date === d);

console.log("\norder-level discounts reach the net");
{
  // #100110971000 is tagged "Collab Gift": two items at full list price, a
  // 100% ORDER-level discount, $0.00 collected. discountedTotalSet still
  // reads $24.99 + $12.99 because it only ever sees LINE-level discounts,
  // which is how this order used to book $37.98 of revenue that never
  // existed. currentQuantity stays 1, so refund logic could never catch it.
  eq("the $0.00 comp order books no revenue", day("2026-08-12")?.net_sales, 0);
  eq("its full list price is recorded as discount", day("2026-08-12")?.discounts, 37.98);

  // #100111711000 carried a $1.59 order-level discount on a $7.99 item.
  eq("a partial order discount lands too", day("2026-08-28")?.net_sales, 19.39);
}

console.log("\nshipping is revenue and is counted");
{
  // Checked against Shopify Analytics on the three days in the window with
  // no Amazon-channel orders to muddy the comparison.
  eq("2026-08-28 postage", day("2026-08-28")?.shipping, 17.71);
  eq("2026-08-29 postage", day("2026-08-29")?.shipping, 24.62);
  eq("2026-08-30 postage", day("2026-08-30")?.shipping, 17.53);
  eq("window postage", sum(totalRows, "shipping"), 195.86);

  // NOT totalShippingPriceSet. That field reports the $8.00 originally
  // charged on the Juzo order whose shipping was then discounted away, and
  // reports $8.00 on #100110551000 where Shopify's own analytics says $0.
  eq("free-shipping discount leaves no postage",
     orderShipping(orders.find((o) => o.name === "#100110551000")), 0);
  // A fully refunded order refunds its postage with it.
  eq("a refunded order keeps no postage",
     orderShipping(orders.find((o) => o.name === "#100110271000")), 0);
}

console.log("\ntax is recorded but is not revenue");
{
  eq("the one taxed order's tax", day("2026-08-28")?.taxes, 2.20);
  eq("window tax", sum(totalRows, "taxes"), 2.20);
  ok("tax is not inside net_sales", !totalRows.some((r) => r.taxes && r.net_sales % 1 === 0.2));
}

console.log("\na renamed product stays one product");
{
  // The hydrocolloid roll was retitled mid-window. Keyed on title it split
  // into "Medical-Grade Hydrocolloid Roll, Cut-to-Size" ($54.95) and
  // "Hydrocolloid Roll, Cut-to-Size" ($117.89) and lost the top spot to
  // Collagen Wound Powder, which had never outsold it.
  const titles = new Set(productRows.map((r) => r.product_title));
  ok("the old roll title is gone", !titles.has("Medical-Grade Hydrocolloid Roll, Cut-to-Size"));
  ok("the old sock title is gone", !titles.has("Medical-Grade Compression Socks, 20-30 mmHg"));

  const net = (t) => Math.round(productRows.filter((r) => r.product_title === t)
    .reduce((n, r) => n + r.net_sales, 0) * 100) / 100;
  // $172.84 at list across both titles, less the $12.99 that went out on
  // the comp order and the $1.59 order discount on 2026-08-28.
  eq("the roll is whole again", net("Hydrocolloid Roll, Cut-to-Size"), 158.26);
  eq("and it is the top storefront product",
     [...new Set(productRows.map((r) => r.product_title))]
       .sort((a, b) => net(b) - net(a))[0],
     "Hydrocolloid Roll, Cut-to-Size");
}

console.log("\nper-product order counts are orders, not line items");
{
  // #100111251000 holds two Collagen Kit variants. Counting line items made
  // one order look like two.
  const kit = productRows.filter((r) =>
    r.product_title === "Collagen Kit" && r.date === "2026-08-17");
  eq("a two-variant order counts once per variant row",
     kit.reduce((n, r) => n + r.orders, 0), 2);
  ok("and each row says one order", kit.every((r) => r.orders === 1));
}

console.log("\nwhat was already right stays right");
{
  eq("cancelled orders are skipped", day("2026-08-13"), undefined);
  eq("a fully refunded order nets zero", day("2026-07-28")?.net_sales, 0);
  eq("Juzo is excluded", shaped.excludedLines, 1);
  // 2026-07-21 holds two orders: the Juzo-only one, which brings neither
  // revenue nor postage, and #100110111000, which brings $8.00 of postage.
  // A day total of $8.00 is the Juzo order contributing nothing.
  eq("a Juzo-only order brings no postage with it", day("2026-07-21")?.shipping, 8);
  eq("marketplace orders never arrive here", shaped.marketplaceOrders, 0);
  // Evening orders belong to the store's day, not UTC's.
  eq("2026-08-30 is the store's day, not UTC's", day("2026-08-30")?.net_sales, 63.96);
}

console.log("\nthe window totals");
{
  eq("net product sales", sum(totalRows, "net_sales"), 666.09);
  // 30 storefront orders, less one cancelled and one that held nothing but
  // Juzo. The comp order still counts — it is an order, it just took no money.
  eq("orders", totalRows.reduce((n, r) => n + r.orders, 0), 28);
  // What the storefront actually took in: product plus postage. Tax is not
  // in this, deliberately.
  eq("storefront revenue",
     Math.round((sum(totalRows, "net_sales") + sum(totalRows, "shipping")) * 100) / 100,
     861.95);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
