// Placement math for the dashboard grid. dashboard.js exports overlaps,
// findFreeCell, settle and autoPlace "for the placement tests" — this is them.
//
// Run: node test/placement.test.mjs
//
// No framework on purpose: the portal has no build step and no dependencies,
// and this file has to stay runnable with bare node like everything else here.

import { overlaps, findFreeCell, settle, autoPlace, SPANS, HEIGHTS, COLS } from "../js/placement.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const W = (x, y, w, h = 1, id = `w${x}${y}`) => ({ id, x, y, w, h });

console.log("\nwidths tile a 12-column row");
{
  // The original bug: with spans [3,4,6,8,12] a half beside a third left two
  // columns that no available width could ever fill.
  const widths = SPANS.map((s) => s.w);
  const reachable = new Set([0]);
  for (let i = 0; i < 6; i++)
    for (const r of [...reachable]) for (const w of widths) if (r + w <= COLS) reachable.add(r + w);
  const stranded = [...reachable].filter((used) => used < COLS && !widths.some((w) => w <= COLS - used));
  eq("no partial row can strand columns", stranded, []);
  ok("a half beside a third can be closed", widths.some((w) => w <= COLS - 6 - 4), "6+4 leaves 2");
  ok("two-thirds beside a quarter can be closed", widths.some((w) => w <= COLS - 8 - 3), "8+3 leaves 1");
}

console.log("\noverlaps respects both axes");
{
  ok("same row, columns intersect", overlaps(W(0, 0, 6), W(4, 0, 6)));
  ok("same row, columns apart", !overlaps(W(0, 0, 4), W(4, 0, 4)));
  ok("same columns, rows apart", !overlaps(W(0, 0, 4), W(0, 1, 4)));
  // The row-span cases the one-row-tall model could not express.
  ok("tall widget reaches into the row below", overlaps(W(0, 0, 4, 2), W(0, 1, 4, 1)));
  ok("tall widget stops short of the row after", !overlaps(W(0, 0, 4, 2), W(0, 2, 4, 1)));
  ok("two tall widgets side by side never touch", !overlaps(W(0, 0, 6, 3), W(6, 0, 6, 3)));
}

console.log("\nfindFreeCell fills holes before opening rows");
{
  eq("empty grid places at origin", findFreeCell([], 4, 1), { x: 0, y: 0 });
  eq("slots into the gap beside a widget", findFreeCell([W(0, 0, 4)], 4, 1), { x: 4, y: 0 });
  eq("opens a row only when the first is full", findFreeCell([W(0, 0, 12)], 4, 1), { x: 0, y: 1 });
  // A tall widget must not be offered a cell that its lower half would collide in.
  eq("tall widget skips a cell its body would hit", findFreeCell([W(0, 0, 12), W(0, 1, 12)], 6, 2), { x: 0, y: 2 });
}

console.log("\nsettle keeps the dropped widget exactly where it was put");
{
  const dropped = W(0, 0, 6, 1, "dropped");
  const other = W(0, 0, 6, 1, "other");
  settle([dropped, other], dropped);
  eq("anchor holds its cell", { x: dropped.x, y: dropped.y }, { x: 0, y: 0 });
  ok("displaced widget moved off the anchor", !overlaps(dropped, other));
}
{
  const items = [W(0, 0, 6, 2, "tall"), W(0, 1, 6, 1, "under")];
  settle(items, items[0]);
  ok("a widget under a tall anchor is pushed clear", !overlaps(items[0], items[1]));
}

console.log("\nautoPlace gives unplaced widgets a home");
{
  const items = [{ id: "a", w: 6, h: 1, x: 0, y: 0 }, { id: "b", w: 6, h: 1 }];
  autoPlace(items);
  ok("new widget did not stack on the placed one", !overlaps(items[0], items[1]));
  ok("new widget got integer coordinates", Number.isInteger(items[1].x) && Number.isInteger(items[1].y));
  eq("new widget defaults to one row tall", items[1].h, 1);
}

console.log("\nheights are offered");
ok("HEIGHTS exposes more than one row", Array.isArray(HEIGHTS) && HEIGHTS.length > 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
