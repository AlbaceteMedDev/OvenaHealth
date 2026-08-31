// Parsing a carrier print-history export.
//
// Run: node test/postage.test.mjs
//
// The fixture is the real Stamps.com export for 2026-07-22..08-26 with the
// recipient columns stripped to first names and zeroed addresses — the money,
// dates, carriers and tracking numbers are untouched, because those are what
// the parser is judged on. Every expected figure was computed from the
// original file before the parser existed.

import { parseLabels, classify, postcode } from "../js/postage-parse.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(HERE, "fixtures", "print-history-2026-07-22.csv"), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) =>
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const rows = parseLabels(text);
const round = (n) => Math.round(n * 100) / 100;
const counted = rows.filter((r) => !r.excluded && !/^approved$/i.test(r.refund));

console.log("\nevery label is read");
{
  eq("labels parsed", rows.length, 195);
  ok("tracking numbers are unique", new Set(rows.map((r) => r.tracking)).size === 195);
  ok("every row has an ISO date", rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
  // MM/DD/YYYY must not go through new Date(), which would shift a label to
  // the previous day in any timezone west of UTC.
  eq("08/26/2026 parses as the 26th", rows.find((r) => r.tracking === "1Z14CY170317310942")?.date, "2026-08-26");
  eq("earliest day", rows.map((r) => r.date).sort()[0], "2026-07-22");
  eq("latest day", rows.map((r) => r.date).sort().at(-1), "2026-08-26");
}

console.log("\nthe money");
{
  eq("gross postage across every label", round(rows.reduce((n, r) => n + r.amount, 0)), 1860.02);
  // Amount Paid ($1,858.92) plus Adjusted Amount ($1.10): a carrier reweigh
  // is money paid for that label.
  ok("adjustments are included", round(rows.reduce((n, r) => n + r.amount, 0)) > 1858.92);
  eq("charged to Ovena, after exclusions", round(counted.reduce((n, r) => n + r.amount, 0)), 1735.19);
  // 195 less 10 StrideCare less the one label whose refund was APPROVED.
  eq("labels charged", counted.length, 184);
  eq("average charged", round(counted.reduce((n, r) => n + r.amount, 0) / counted.length), 9.43);
}

console.log("\na refund only stops counting once it is approved");
{
  // The approved one is already $0.00 from the carrier, so dropping it moves
  // the count and not the money — which is the tell that this is right.
  const approved = rows.filter((r) => /^approved$/i.test(r.refund));
  eq("approved refunds", approved.length, 1);
  eq("and it cost nothing", round(approved.reduce((n, r) => n + r.amount, 0)), 0);
  // "Request Scheduled" is not yet a refund, so it is still a cost.
  const pending = rows.filter((r) => /request scheduled/i.test(r.refund));
  eq("refunds merely requested", pending.length, 2);
  ok("and they are still charged", pending.every((r) => r.amount > 0));
}

console.log("\nStrideCare is another business's postage");
{
  const ex = rows.filter((r) => r.excluded);
  eq("excluded labels", ex.length, 10);
  eq("excluded postage", round(ex.reduce((n, r) => n + r.amount, 0)), 124.83);
  ok("all of them are StrideCare", ex.every((r) => /stridecare/i.test(r.recipient)));
  // The six on one day are what makes this worth excluding rather than
  // rounding away.
  eq("six on 2026-08-11", ex.filter((r) => r.date === "2026-08-11").length, 6);
}

console.log("\ncarriers survive the trip");
{
  const ups = rows.filter((r) => r.carrier === "UPS");
  eq("UPS labels", ups.length, 193);
  eq("USPS labels", rows.filter((r) => r.carrier === "USPS").length, 2);
  eq("ground is the bulk of it", rows.filter((r) => r.service === "UPS® Ground").length, 159);
}

console.log("\nbad input is refused rather than half-read");
{
  eq("a file with no tracking column", parseLabels("date printed,amount paid\n08/26/2026,7.10"), null);
  eq("headers only", parseLabels("tracking #,date printed,amount paid"), null);
  eq("empty", parseLabels(""), null);
  // A repeated tracking number inside one file is one label listed twice.
  const dup = parseLabels(
    'tracking #,date printed,amount paid\nAAA,08/26/2026,7.10\nAAA,08/26/2026,7.10\nBBB,08/26/2026,3.00');
  eq("a repeated tracking number counts once", dup.length, 2);
  eq("and keeps the right total", round(dup.reduce((n, r) => n + r.amount, 0)), 10.10);
}

console.log("\npostcodes are the join, so both sides must reduce alike");
{
  // The carrier writes ="76179", Amazon writes 07652-4305, Canada has a space.
  eq("a spreadsheet-escaped zip", postcode('="76179"'), "76179");
  eq("ZIP+4 keeps five", postcode("07652-4305"), "07652");
  eq("a leading zero survives", postcode('="02035"'), "02035");
  eq("a Canadian postcode", postcode("V5C 0N2"), "V5C0N");
  eq("nothing in, nothing out", postcode(""), "");
  ok("every label carries one", rows.every((r) => r.postal.length === 5));
}

console.log("\nlabels are attributed by where they went");
{
  // The real split, measured 2026-08-31: a label going to a postcode Amazon
  // merchant-fulfilled an order to is Amazon's; everything else is the
  // storefront's. Amazon buyers paid $27.70 of shipping across 137 FBM
  // orders, the storefront charged $120.00 across 19 — which is the whole
  // reason these cannot share one P&L line.
  const fbm = new Set(["94501", "85281", "14580", "23666"]);
  const tagged = rows.map((r) => ({ ...r, channel: classify(r, fbm) }));
  ok("a postcode Amazon shipped to is Amazon's",
     tagged.filter((r) => fbm.has(r.postal) && !r.excluded).every((r) => r.channel === "amazon_fbm"));
  ok("everything else is the storefront's",
     tagged.filter((r) => !fbm.has(r.postal) && !r.excluded).every((r) => r.channel === "storefront"));
  // Exclusion outranks attribution: another business's postage is neither.
  ok("an excluded shipper is never charged to a channel",
     tagged.filter((r) => r.excluded).every((r) => r.channel === "excluded"));
  // With no order history loaded nothing can be Amazon's — it must not
  // guess, and it must not throw.
  ok("no order history means no Amazon attribution",
     rows.every((r) => classify(r, new Set()) !== "amazon_fbm"));
  ok("an absent set is survivable", classify(rows[0], undefined) !== "amazon_fbm");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
