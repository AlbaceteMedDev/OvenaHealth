// Where widgets sit on the dashboard grid.
//
// Pure geometry, no DOM and no network, so it can be exercised directly by
// test/placement.test.mjs. It used to live in dashboard.js, which imports the
// Supabase client from a CDN and therefore cannot be loaded by bare node —
// the reason the "placement tests" that file mentions were never written.
//
// Layout items are { id, w, h, x, y }: a column span, a row span, and an
// explicit cell on a 12-column grid. Explicit placement is what lets a widget
// sit anywhere, gaps included — but it also means CSS grid will cheerfully
// render two widgets on top of each other, so every mutation is checked here.

export const COLS = 12;

// Column spans offered in edit mode.
//
// 1 and 2 exist for closure, not because anyone wants a 1/12 widget. With the
// old set — 3, 4, 6, 8, 12 — a half beside a third used 10 columns and left 2
// that NO available width could fill, and two-thirds beside a quarter left 1.
// Those remainders were unreachable dead space for the life of the dashboard,
// which is what made widgets so hard to place next to each other. Any row can
// now be closed exactly. test/placement.test.mjs proves it by exhausting every
// reachable partial sum.
export const SPANS = [
  { w: 1, label: "1" },
  { w: 2, label: "2" },
  { w: 3, label: "¼" },
  { w: 4, label: "⅓" },
  { w: 6, label: "½" },
  { w: 8, label: "⅔" },
  { w: 12, label: "Full" },
];

// Row spans. Every widget used to occupy exactly one row, and a row sizes to
// its tallest member, so one tall chart inflated the whole row and every short
// tile beside it sat above a band of dead space that could not be reclaimed.
// A widget can now claim the height it actually needs, which lets two short
// tiles stack in the space one tall one occupies.
export const HEIGHTS = [
  { h: 1, label: "1×" },
  { h: 2, label: "2×" },
  { h: 3, label: "3×" },
];

const MAX_H = Math.max(...HEIGHTS.map((s) => s.h));

// Footprints intersect when they overlap on BOTH axes. The row half of this
// is what row spans made necessary — comparing y for equality was only ever
// correct while every widget was exactly one row tall.
export function overlaps(a, b) {
  const ah = a.h || 1, bh = b.h || 1;
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + bh && b.y < a.y + ah;
}

// First cell at or after startY where this footprint touches nothing. Scans
// left to right, top to bottom, so it fills a gap before opening a new row —
// a dashboard with a hole in it gets the hole used, not a fresh row.
export function findFreeCell(taken, w, h = 1, startY = 0) {
  for (let y = startY; y < startY + 500; y++) {
    for (let x = 0; x <= COLS - w; x++) {
      if (!taken.some((it) => overlaps({ x, y, w, h }, it))) return { x, y };
    }
  }
  return { x: 0, y: startY };
}

function clamp(it) {
  it.w = Math.max(1, Math.min(COLS, Number(it.w) || 1));
  it.h = Math.max(1, Math.min(MAX_H, Number(it.h) || 1));
  it.x = Math.max(0, Math.min(COLS - it.w, Number.isInteger(it.x) ? it.x : 0));
  it.y = Math.max(0, Number.isInteger(it.y) ? it.y : 0);
}

// Force a set of items into a non-overlapping arrangement, in reading order.
// `anchor` is settled first and never moves — after a drop, the widget the
// user just placed is the one thing that must stay exactly where it was put.
export function settle(items, anchor = null) {
  const taken = [];
  if (anchor) { clamp(anchor); taken.push(anchor); }
  const rest = items
    .filter((it) => it !== anchor)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  for (const it of rest) {
    clamp(it);
    if (taken.some((t) => overlaps(it, t))) {
      const cell = findFreeCell(taken, it.w, it.h, it.y);
      it.x = cell.x; it.y = cell.y;
    }
    taken.push(it);
  }
  return items;
}

// Items saved before placement existed have no x/y, and newly added widgets
// start without one. Both get the first free cell rather than defaulting to
// 0,0 — which is what stacked every added widget onto the top-left corner.
// Items saved before row spans existed have no h either, and default to 1.
export function autoPlace(items) {
  for (const it of items) if (!Number.isInteger(it.h)) it.h = 1;
  const taken = items.filter((it) => Number.isInteger(it.x) && Number.isInteger(it.y));
  for (const it of items) {
    if (Number.isInteger(it.x) && Number.isInteger(it.y)) continue;
    const cell = findFreeCell(taken, it.w, it.h, 0);
    it.x = cell.x; it.y = cell.y;
    taken.push(it);
  }
  return settle(items);
}
