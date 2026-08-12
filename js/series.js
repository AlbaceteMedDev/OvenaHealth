// Time bucketing for every chart and table.
//
// Everything in Supabase is stored per day. This rolls those daily rows up
// into day / week / month / year buckets on the client, so switching
// granularity is instant and never re-queries.
//
// Bucket keys are plain calendar strings and are compared as strings, which
// only works because every format is zero-padded and big-endian:
//   day    2026-08-03
//   week   2026-W32   (ISO week, Monday start)
//   month  2026-08
//   year   2026

export const GRAINS = ["day", "week", "month", "year"];

export const GRAIN_LABELS = { day: "Day", week: "Week", month: "Month", year: "Year" };

// Parse a YYYY-MM-DD calendar date as UTC. Using UTC throughout avoids the
// off-by-one-day drift that local-time parsing causes west of Greenwich.
function utc(dateStr) {
  return new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
}

// ISO-8601 week: weeks start Monday, week 1 contains the first Thursday.
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of the current week determines the year the week belongs to.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const year = t.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  return { year, week };
}

export function bucketKey(dateStr, grain) {
  const iso = String(dateStr).slice(0, 10);
  if (grain === "day") return iso;
  if (grain === "month") return iso.slice(0, 7);
  if (grain === "year") return iso.slice(0, 4);
  const { year, week } = isoWeek(utc(iso));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Human label for a bucket key, e.g. "3 Aug", "W32 · 3–9 Aug", "Aug 2026".
export function bucketLabel(key, grain) {
  if (grain === "year") return key;
  if (grain === "month") {
    const [y, m] = key.split("-");
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  if (grain === "week") {
    const [y, w] = key.split("-W");
    const { start, end } = weekRange(Number(y), Number(w));
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    return sameMonth
      ? `${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`
      : `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
  }
  const d = utc(key);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Calendar span a bucket covers, as [startIso, endIso].
export function bucketSpan(key, grain) {
  if (grain === "day") return [key, key];
  if (grain === "year") return [`${key}-01-01`, `${key}-12-31`];
  if (grain === "month") {
    const [y, m] = key.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [`${key}-01`, `${key}-${String(last).padStart(2, "0")}`];
  }
  const [y, w] = key.split("-W").map(Number);
  const { start, end } = weekRange(y, w);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

// A bucket is partial when the reporting floor or today cuts through it —
// its total covers fewer days than the label implies. Weekly and monthly
// views are otherwise easy to misread at the edges.
export function isPartialBucket(key, grain, floorIso, todayIso) {
  if (grain === "day") return false;
  const [start, end] = bucketSpan(key, grain);
  return (floorIso && start < floorIso) || (todayIso && end > todayIso);
}

// Monday–Sunday span of an ISO week, for week labels and CSV ranges.
export function weekRange(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start, end };
}

// Roll rows into buckets. `pick(row)` returns the numeric fields to sum;
// every key is added. Returns an array sorted by bucket key ascending.
//
// `dedupe(row)` is optional: when supplied, rows sharing a dedupe key inside
// the same bucket contribute their picked values only once. Amazon reports
// sessions per ASIN, repeated on every SKU row for that ASIN, so summing
// them raw multiplies traffic by the number of SKUs on the listing.
export function bucketSeries(rows, grain, pick, { dateField = "date", dedupe = null } = {}) {
  const buckets = new Map();
  const seen = new Set();

  for (const row of rows) {
    const key = bucketKey(row[dateField], grain);
    if (!buckets.has(key)) buckets.set(key, { key, label: bucketLabel(key, grain) });
    const slot = buckets.get(key);

    if (dedupe) {
      const dk = `${key}|${dedupe(row)}`;
      if (seen.has(dk)) continue;
      seen.add(dk);
    }

    for (const [k, v] of Object.entries(pick(row))) {
      slot[k] = (slot[k] || 0) + (Number(v) || 0);
    }
  }

  return [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Fill in buckets that have no rows, so a gap reads as zero rather than
// collapsing the x-axis. Only used for `day`, where absent days are
// genuinely zero; coarser grains are already dense in practice.
export function fillDays(series, startIso, endIso, keys) {
  if (!series.length) return series;
  const out = [];
  const d = utc(startIso);
  const end = utc(endIso);
  const byKey = new Map(series.map((s) => [s.key, s]));
  let guard = 0;
  while (d <= end && guard < 800) {
    const key = d.toISOString().slice(0, 10);
    const hit = byKey.get(key);
    if (hit) out.push(hit);
    else {
      const blank = { key, label: bucketLabel(key, "day") };
      for (const k of keys) blank[k] = 0;
      out.push(blank);
    }
    d.setUTCDate(d.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}
