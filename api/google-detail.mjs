// Google Ads keyword and landing-page detail, read on behalf of a signed-in
// portal user.
//
//   GET /api/google-detail?table=keywords|landing&days=30
//   Authorization: Bearer <the user's Supabase access token>
//
// Why this exists: google_keywords_daily and google_landing_pages_daily were
// created with row-level security on and no read policy, so PostgREST answers
// every browser query with an empty 200 — not an error, just nothing. The
// sync writes them fine (service key). Same situation ads_search_terms was in,
// and the same fix: prove the caller holds a portal session, then read with
// the service key. Adding the policy would also work; this does not depend on
// anyone remembering to.

import { select } from "./_lib/db.mjs";
import { DATA_START } from "../js/config.js";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLES = Object.create(null);
TABLES.keywords = {
  name: "google_keywords_daily",
  cols: "date,keyword,match_type,campaign_name,ad_group_name,impressions,clicks,cost,conversions,conversion_value",
};
TABLES.landing = {
  name: "google_landing_pages_daily",
  cols: "date,landing_page,campaign_name,impressions,clicks,cost,conversions,conversion_value",
};

async function isPortalUser(req) {
  const token = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !URL_BASE || !SERVICE_KEY) return false;
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` },
  });
  return res.ok;
}

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
  const key = url.searchParams.get("table") || "keywords";
  if (!Object.prototype.hasOwnProperty.call(TABLES, key)) {
    res.status(400).json({ error: "table must be keywords or landing" });
    return;
  }
  const t = TABLES[key];
  const days = url.searchParams.get("days") || "30";
  try {
    const rows = await select(
      t.name,
      `select=${t.cols}&date=gte.${startDateFor(days)}&order=cost.desc&limit=8000`,
    );
    res.setHeader("cache-control", "private, max-age=60");
    res.status(200).json({ table: t.name, since: startDateFor(days), rows });
  } catch (err) {
    console.error("[google-detail]", err);
    res.status(502).json({ error: "Could not read the Google Ads detail tables." });
  }
}
