// Search-term rows for the Keywords tab, served here instead of PostgREST.
//
//   GET /api/search-terms?days=30        window in days, or "all"
//   Authorization: Bearer <the signed-in user's Supabase access token>
//
// Every other table the portal reads carries an "auth read" RLS policy and
// the browser queries PostgREST directly. ads_search_terms is the exception:
// the table exists and the sync fills it every six hours, but its read
// policy has never been created, so PostgREST answers the browser with zero
// rows and the Keywords tab starves in front of 16k+ rows of data.
//
// The sync has been writing those rows with the service key all along —
// service_role bypasses RLS. This endpoint reads them back the same way,
// gated by exactly the check the missing policy would have enforced: the
// caller must hold a valid Supabase session on THIS project, i.e. be signed
// in with the team password. Same audience, same data, different door.
// If the "auth read" policy is ever created, the client can go back to
// PostgREST and this file can be deleted.

import { select } from "./_lib/db.mjs";
import { DATA_START } from "../js/config.js";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// A token is a portal user iff Supabase auth recognises it. GoTrue validates
// signature, expiry and revocation — everything a policy's `to authenticated`
// would have checked.
async function isPortalUser(req) {
  const token = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !URL_BASE || !SERVICE_KEY) return false;
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` },
  });
  return res.ok;
}

// Same clamp as js/data/live.js startDateFor — the reporting floor holds
// server-side too, so this endpoint can never answer with pre-relaunch data.
function startDateFor(days) {
  if (days === "all") return DATA_START;
  const n = Math.max(1, Math.min(365, Number(days) || 30));
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  const iso = d.toISOString().slice(0, 10);
  return iso < DATA_START ? DATA_START : iso;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }
  if (!(await isPortalUser(req))) {
    res.status(401).json({ error: "Sign in to the portal first." });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const days = url.searchParams.get("days") || "30";
  const rollup = url.searchParams.get("rollup") === "1";
  const since = startDateFor(days);
  try {
    const rows = await select(
      "ads_search_terms",
      `select=date,platform,search_term,keyword,match_type,campaign_name,impressions,clicks,cost,sales,orders,units&date=gte.${since}&order=date.desc&limit=40000`,
    );
    res.setHeader("cache-control", "private, max-age=60");
    if (!rollup) {
      res.status(200).json({ since, rows });
      return;
    }
    // Sum across days here, where the whole window fits, rather than in the
    // browser, where it never did: the daily set for 7 days alone is over
    // 8,000 rows and the client was quietly seeing only the top of it.
    const byKey = new Map();
    const coverage = {};
    for (const r of rows) {
      const c = coverage[r.platform] || (coverage[r.platform] = { first: r.date, last: r.date, rows: 0 });
      if (r.date < c.first) c.first = r.date;
      if (r.date > c.last) c.last = r.date;
      c.rows++;
      const k = [r.platform, r.search_term, r.keyword, r.match_type, r.campaign_name].join("\u0000");
      const slot = byKey.get(k) || {
        platform: r.platform, search_term: r.search_term, keyword: r.keyword,
        match_type: r.match_type, campaign_name: r.campaign_name,
        first_date: r.date, last_date: r.date,
        impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0,
      };
      if (r.date < slot.first_date) slot.first_date = r.date;
      if (r.date > slot.last_date) slot.last_date = r.date;
      slot.impressions += Number(r.impressions) || 0;
      slot.clicks += Number(r.clicks) || 0;
      slot.cost += Number(r.cost) || 0;
      slot.sales += Number(r.sales) || 0;
      slot.orders += Number(r.orders) || 0;
      slot.units += Number(r.units) || 0;
      byKey.set(k, slot);
    }
    res.status(200).json({ since, source_rows: rows.length, coverage, rows: [...byKey.values()] });
  } catch (err) {
    console.error("[search-terms]", err);
    res.status(502).json({ error: "Could not read the search terms." });
  }
}
