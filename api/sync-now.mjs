// Run a sync on demand, for someone using the portal.
//
//   POST /api/sync-now?job=searchterms
//   Authorization: Bearer <the caller's Supabase access token>
//
// Search terms are pulled every six hours. Between runs the Keywords tab
// cannot be made newer by reloading it — the data on screen is already the
// newest that exists — so "refresh" could never be the fix. This makes the
// pull itself available.
//
// The sync routes are guarded by CRON_SECRET, which the browser does not
// have and must never be given: it is the key to every write endpoint here.
// So the secret stays server-side and this route invokes the sync in-process.
//
// ON THE GATE, HONESTLY: js/main.js signs users in ANONYMOUSLY on purpose —
// the portal is deliberately passwordless. An anonymous Supabase user still
// carries the `authenticated` role, so a session token proves only that
// somebody reached this project, which anyone holding the public anon key
// can do. Every table is already readable on those terms, so this route
// gives away no READ access that PostgREST does not. What it does add is a
// WRITE and a metered third-party call, and that is what the limits below
// are for: they are the actual security boundary, not the token check.
//
// Adding a job here is not a free action. `orders` in particular accepts an
// uploaded TSV and a ?rebuild= flag; it must not be exposed this way without
// its own review.

import { select } from "./_lib/db.mjs";
import runSearchTerms from "./sync/searchterms.mjs";
import runShopify from "./sync/shopify.mjs";
import runOrders from "./sync/orders.mjs";
import runCatchr from "./sync/catchr.mjs";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Allowlisted jobs, holding the handler itself. A STATIC import, deliberately:
// a computed `await import(job.module)` resolves under `vercel dev` against
// the real filesystem and then fails in production, because Vercel traces
// each api/ entrypoint's file set from its static imports and a computed
// specifier is not traced. It would have shipped green and 500'd live.
const JOBS = Object.create(null);
JOBS.searchterms = { run: runSearchTerms, days: 30, label: "search terms" };

// Shopify is the one source here that is genuinely live: the Admin API
// returns the order placed a minute ago. Everything else on this dashboard
// reports on a delay, so this is the only job where "sync now" makes the
// page newer rather than merely re-fetching the same rows.
//
// It re-reads the whole window from DATA_START on every run and prunes what
// it did not produce, so it is safe to run at any time and never leaves a
// half-window behind. Cost is one Admin API call per five orders.
JOBS.shopify = { run: runShopify, days: null, label: "Shopify orders", cooldownMs: 60_000, maxPerDay: 100 };

// Amazon orders. Exposing this one needs a word, because the handler also
// accepts an uploaded TSV on POST and a ?rebuild=1 that rewrites history —
// neither of which a portal user should be able to reach. They cannot: the
// request below is built here, not forwarded, so it is always a GET with a
// fixed query string and no body. Nothing the caller sends reaches it except
// the choice of job name, which the allowlist has already checked.
//
// Amazon's own order feed trails Seller Central by a while, so this is
// closer to "catch up" than to "live" — but it is the difference between a
// dashboard that is up to 30 minutes stale and one that is not.
JOBS.orders = { run: runOrders, days: 30, label: "Amazon orders", maxPerDay: 80 };

// Advertising spend, from Catchr. Reports 1-3 days behind.
JOBS.catchr = { run: runCatchr, days: 7, label: "advertising", maxPerDay: 80 };

// How long after a finished run the next one is refused. Catchr-backed jobs
// report 1-3 days behind, so nothing a button does can make them fresher and
// a short cooldown would buy no freshness and a lot of billable queries.
// Shopify is live and free to us, so it overrides this with its own minute.
const COOLDOWN_MS = 600_000;      // 10 minutes between finished runs
const INFLIGHT_MS = 300_000;      // a started-but-unfinished run is live this long

// The daily ceiling, and an honest account of what it measures.
//
// sync_runs does not record what TRIGGERED a run, so this counts the cron's
// runs alongside the button's. That is fine for searchterms, whose cron fires
// four times a day and leaves the whole allowance to people. It is useless
// for a job on a 30-minute cron: shopify alone logs 48 runs a day, so a flat
// cap of 12 refused the button permanently — "already synced 48 times today"
// on the very first press, which is what this default did before the
// cron-driven jobs were added here.
//
// So each job's ceiling sits above its own cron rate, and the real brake on
// somebody leaning on the button is the cooldown above, which is per-job and
// which the cron cannot exhaust.
const MAX_RUNS_PER_DAY = 12;

async function isPortalUser(req) {
  const token = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !URL_BASE || !SERVICE_KEY) return false;
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (!(await isPortalUser(req))) {
    res.status(401).json({ error: "Sign in to the portal first." });
    return;
  }
  if (!process.env.CRON_SECRET) {
    res.status(503).json({ error: "CRON_SECRET is not set, so syncs cannot be triggered." });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const name = url.searchParams.get("job") || "searchterms";
  // hasOwnProperty, not a truthiness test: `?job=constructor` would otherwise
  // find a prototype member, pass the guard, and crash the function.
  if (!Object.prototype.hasOwnProperty.call(JOBS, name)) {
    res.status(400).json({ error: `Unknown job. Allowed: ${Object.keys(JOBS).join(", ")}` });
    return;
  }
  const job = JOBS[name];

  // The limits. Read from the job's own audit trail rather than memory, which
  // does not survive between serverless invocations.
  try {
    const recent = await select(
      "sync_runs",
      `select=started_at,finished_at&job=eq.${encodeURIComponent(name)}&order=started_at.desc&limit=1`,
    );
    const row = recent?.[0];
    const started = row?.started_at ? Date.parse(row.started_at) : 0;
    const finished = row?.finished_at ? Date.parse(row.finished_at) : 0;

    // Already running. The sync deletes and re-inserts per platform, so two
    // overlapping runs can have one delete rows the other has just written.
    if (started && !finished && Date.now() - started < INFLIGHT_MS) {
      res.status(409).json({ error: `A ${job.label} sync is already running. Give it a moment.` });
      return;
    }
    const cooldown = job.cooldownMs ?? COOLDOWN_MS;
    if (finished && Date.now() - finished < cooldown) {
      const wait = Math.max(1, Math.ceil((cooldown - (Date.now() - finished)) / 60_000));
      res.status(429).json({
        error: `${job.label} synced less than ${Math.round(cooldown / 60_000)} minute(s) ago. Give it a moment.`,
        retryInMinutes: wait,
      });
      return;
    }

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const today = await select(
      "sync_runs",
      `select=started_at&job=eq.${encodeURIComponent(name)}&started_at=gte.${encodeURIComponent(since)}`,
    );
    const ceiling = job.maxPerDay ?? MAX_RUNS_PER_DAY;
    if ((today?.length || 0) >= ceiling) {
      res.status(429).json({
        error: `${job.label} has already synced ${today.length} times today, scheduled runs included. The crons will keep it current.`,
      });
      return;
    }
  } catch {
    // A failed audit read is not itself a reason to refuse the sync.
  }

  // The handler expects what a platform request looks like: params on the
  // url, the secret in the header. Its response is captured, not sent, so
  // this route can wrap it.
  const captured = { code: 200, body: null };
  const proxyRes = {
    status(c) { captured.code = c; return this; },
    json(o) { captured.body = o; return this; },
  };

  try {
    // Built here, never forwarded from the caller. See the note on JOBS.orders.
    await job.run(
      {
        method: "GET",
        url: job.days == null ? `/api/sync/${name}` : `/api/sync/${name}?days=${job.days}`,
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      },
      proxyRes,
    );
  } catch (err) {
    console.error(`[sync-now] ${name} threw:`, err);
    res.status(500).json({ error: `The ${job.label} sync failed. Check the sync history.` });
    return;
  }

  // 207 means some platforms landed and others did not — a partial success.
  // Collapsing it into a failure would tell someone their sync broke while
  // thousands of rows were written, and invite them to pay to run it again.
  const ok = captured.code === 200 || captured.code === 207;
  res.status(ok ? 200 : 502).json({
    job: name,
    partial: captured.code === 207,
    result: captured.body,
  });
}
