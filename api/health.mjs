// Diagnostics for the sync layer.
//
//   GET /api/health              which credentials are present, last sync runs
//   GET /api/health?probe=1      discover Catchr's endpoint path + auth style
//
// The probe exists because Catchr does not publish its REST contract. It
// tries each plausible (path, auth header) combination against a 1-row
// query and reports the one that works, so you can pin it in env vars
// instead of guessing. Guarded by CRON_SECRET like the sync routes —
// probe responses describe your account setup.

import { probe } from "./_lib/catchr.mjs";
import { select } from "./_lib/db.mjs";
import { SELLER_ACCOUNTS, AMAZON_ADS_ACCOUNTS, FACEBOOK_ADS_ACCOUNTS, GOOGLE_ADS_ACCOUNTS } from "./_lib/accounts.mjs";
import { isConfigured as spapiConfigured } from "./_lib/spapi.mjs";

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization || "";
  const url = new URL(req.url, "http://localhost");
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized. Pass ?secret=<CRON_SECRET>." });
    return;
  }

  const out = {
    env: {
      CATCHR_API_KEY: Boolean(process.env.CATCHR_API_KEY),
      CATCHR_API_BASE: process.env.CATCHR_API_BASE || "https://api.catchr.io (default)",
      CATCHR_QUERY_PATH: process.env.CATCHR_QUERY_PATH || "/query/{platform} (default)",
      CATCHR_AUTH_STYLE: process.env.CATCHR_AUTH_STYLE || "bearer (default)",
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      SPAPI: spapiConfigured(),
    },
    accounts: {
      amazonSeller: SELLER_ACCOUNTS.length,
      amazonAds: AMAZON_ADS_ACCOUNTS.length,
      facebookAds: FACEBOOK_ADS_ACCOUNTS.length,
      googleAds: GOOGLE_ADS_ACCOUNTS.length,
    },
  };

  try {
    out.recentRuns = await select(
      "sync_runs",
      "select=job,status,rows_written,started_at,finished_at&order=started_at.desc&limit=10",
    );
  } catch (err) {
    out.recentRuns = { error: err.message };
  }

  if (new URL(req.url, "http://localhost").searchParams.get("probe") === "1") {
    const account = SELLER_ACCOUNTS[0];
    out.catchrProbe = await probe("amazon-seller", {
      accounts: [{ id: account.id, authorization_id: account.authorization_id }],
      date: "LAST_7_DAYS",
      dimensions: ["_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY"],
      metrics: ["sales.unitsOrdered"],
    });
  }

  res.status(200).json(out);
}
