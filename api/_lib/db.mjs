// Supabase writer for the sync jobs.
//
// Deliberately dependency-free: the portal has no build step and no
// package.json, so we talk to PostgREST over plain fetch instead of pulling
// in @supabase/supabase-js. The service_role key bypasses RLS, which is why
// these tables carry read-only policies for the browser.
//
//   SUPABASE_URL              https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role key (server only — never ship
//                              this to the client)

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export class DbError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = "DbError";
    this.status = status;
    this.body = body;
  }
}

function assertConfigured() {
  if (!URL_BASE) throw new DbError("SUPABASE_URL is not set");
  if (!SERVICE_KEY) throw new DbError("SUPABASE_SERVICE_ROLE_KEY is not set");
}

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    "content-type": "application/json",
    ...extra,
  };
}

// Upsert rows, chunked so a large backfill doesn't blow the request limit.
// `onConflict` must name the table's primary-key columns.
export async function upsert(table, rows, onConflict, { chunkSize = 500 } = {}) {
  assertConfigured();
  if (!rows.length) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const url = `${URL_BASE}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: headers({ prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new DbError(`upsert ${table} failed (${res.status}): ${body.slice(0, 400)}`, {
        status: res.status,
        body: body.slice(0, 400),
      });
    }
    written += chunk.length;
  }
  return written;
}

// Pages through PostgREST. Supabase caps any single response at 1,000 rows
// (its max-rows setting) no matter what `limit=` asks for, and it does so
// silently: a query for 8,000 rows gets 1,000 back with a 200. Both the
// Keywords and Google Ads tabs were built on top of that cap without knowing
// it — 1,110 keyword rows synced, 1,000 served, and the difference was the
// cheapest rows, so every total understated. This keeps asking with Range
// until a page comes back short. A caller's own `limit=` still bounds it.
const PAGE = 1000;
const MAX_PAGES = 40;   // 40,000 rows; beyond that the caller should aggregate in SQL

export async function select(table, query = "") {
  assertConfigured();
  const url = `${URL_BASE}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const wanted = Number((query.match(/(?:^|&)limit=(\d+)/) || [])[1]) || Infinity;
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const to = Math.min(from + PAGE, wanted) - 1;
    if (to < from) break;
    const res = await fetch(url, {
      headers: { ...headers(), Range: `${from}-${to}`, "Range-Unit": "items" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new DbError(`select ${table} failed (${res.status}): ${body.slice(0, 400)}`, {
        status: res.status,
      });
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < to - from + 1 || out.length >= wanted) break;
  }
  return out;
}

// Replace the whole contents of a table. Used for fba_inventory, which is a
// current-state snapshot rather than an append-only log: a SKU that drops
// out of Amazon's response should disappear, not linger at its last value.
//
// `stamp` must be the exact synced_at carried by every row in `rows`. The
// prune then deletes strictly older rows. Deriving the cutoff from the clock
// instead would delete rows this very sync had written whenever the run took
// longer than the cutoff window — which a paginated SP-API pull easily does.
export async function replaceAll(table, rows, onConflict, stamp) {
  assertConfigured();
  if (!stamp) throw new DbError(`replaceAll(${table}) requires the rows' synced_at stamp`);

  const written = await upsert(table, rows, onConflict);

  // Only prune when the fetch returned something. An empty response is far
  // more likely to be a transient upstream failure than a genuinely empty
  // catalog, and wiping the table on it would be worse than showing stale data.
  if (rows.length) {
    const url = `${URL_BASE}/rest/v1/${table}?synced_at=lt.${encodeURIComponent(stamp)}`;
    const res = await fetch(url, { method: "DELETE", headers: headers({ prefer: "return=minimal" }) });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new DbError(`prune ${table} failed (${res.status}): ${body.slice(0, 200)}`, {
        status: res.status,
      });
    }
  }
  return written;
}

// Empty a snapshot table. Only for the case where an empty upstream result
// is itself the news — Merchant Center reporting no account issues means the
// account is clean, and leaving the last known issue on screen would say the
// opposite. Callers must have confirmed the fetch SUCCEEDED before calling
// this; an empty response from a failed request means nothing.
export async function clearTable(table) {
  assertConfigured();
  // PostgREST refuses an unfiltered DELETE, so match every row explicitly.
  const url = `${URL_BASE}/rest/v1/${table}?synced_at=not.is.null`;
  const res = await fetch(url, { method: "DELETE", headers: headers({ prefer: "return=minimal" }) });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new DbError(`clear ${table} failed (${res.status}): ${body.slice(0, 200)}`, { status: res.status });
  }
}

// ─── sync_runs bookkeeping ───────────────────────────────────────────
export async function startRun(job) {
  assertConfigured();
  const res = await fetch(`${URL_BASE}/rest/v1/sync_runs`, {
    method: "POST",
    headers: headers({ prefer: "return=representation" }),
    body: JSON.stringify([{ job, status: "ok", started_at: new Date().toISOString() }]),
  });
  if (!res.ok) return null;
  const [row] = await res.json();
  return row?.id ?? null;
}

export async function finishRun(id, { status, rowsWritten = 0, detail = null }) {
  if (!id) return;
  await fetch(`${URL_BASE}/rest/v1/sync_runs?id=eq.${id}`, {
    method: "PATCH",
    headers: headers({ prefer: "return=minimal" }),
    body: JSON.stringify({
      status,
      rows_written: rowsWritten,
      detail,
      finished_at: new Date().toISOString(),
    }),
  });
}

// Seller-SKU → catalog-SKU aliases stored in Supabase, merged over the
// static ones the frontend ships with.
export async function loadSkuAliases() {
  try {
    const rows = await select("amazon_sku_map", "select=amazon_sku,sku");
    return new Map(rows.map((r) => [r.amazon_sku, r.sku]));
  } catch {
    return new Map();
  }
}

// Delete rows matching a PostgREST filter expression, e.g.
//   deleteWhere("amz_sales_daily", "date=gte.2026-07-19&date=lte.2026-08-18")
//
// The order importer rebuilds a date window rather than only upserting into
// it. Amazon's All Orders report is authoritative for the window it covers,
// so a row that survives from an earlier import is a row Amazon no longer
// reports — a cancellation, usually — and it has to go rather than linger at
// its old value. An upsert alone cannot express that.
//
// PostgREST refuses an unfiltered DELETE, and so does this: an empty filter
// would silently empty the table.
export async function deleteWhere(table, filter) {
  assertConfigured();
  if (!filter) throw new DbError(`deleteWhere(${table}) requires a filter`);
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: headers({ prefer: "return=minimal" }),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new DbError(`delete ${table} failed (${res.status}): ${body.slice(0, 200)}`, {
      status: res.status,
    });
  }
}
