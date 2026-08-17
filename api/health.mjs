// Diagnostics for the sync layer.
//
//   GET /api/health              which variables are set, and what is missing
//   GET /api/health?probe=1      discover Catchr's endpoint path + auth style
//
// TWO TIERS, ON PURPOSE.
//
// The env checklist is public. It reports presence as booleans and never a
// value, and it has to be reachable before anything is configured — the whole
// point is to answer "did my setup take?" while setup is still incomplete.
// Gating it behind CRON_SECRET made it useless for that: you could not read
// the checklist until you had already finished the thing the checklist is for.
//
// Everything that describes the account rather than the configuration —
// connected ad accounts, recent sync history, and the Catchr probe — stays
// behind CRON_SECRET.

import { probe } from "./_lib/catchr.mjs";
import { select } from "./_lib/db.mjs";
import { authorized } from "./_lib/auth.mjs";
import { SELLER_ACCOUNTS, AMAZON_ADS_ACCOUNTS, FACEBOOK_ADS_ACCOUNTS, GOOGLE_ADS_ACCOUNTS } from "./_lib/accounts.mjs";
import { isConfigured as spapiConfigured } from "./_lib/spapi.mjs";

// Without these the sync cannot run at all.
const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CATCHR_API_KEY", "CRON_SECRET"];

// Each of these unlocks one tab; absence degrades rather than breaks.
const OPTIONAL = {
  shopify: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"],
  fbaInventory: ["SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN"],
};

const isSet = (name) => Boolean(process.env[name]);

export default async function handler(req, res) {
  const missing = REQUIRED.filter((name) => !isSet(name));

  const out = {
    ready: missing.length === 0,
    missing,
    required: Object.fromEntries(REQUIRED.map((name) => [name, isSet(name)])),
    optional: Object.fromEntries(
      Object.entries(OPTIONAL).map(([feature, names]) => [
        feature,
        Object.fromEntries(names.map((name) => [name, isSet(name)])),
      ]),
    ),
    defaults: {
      CATCHR_API_BASE: process.env.CATCHR_API_BASE || "https://api.catchr.io (default)",
      CATCHR_QUERY_PATH: process.env.CATCHR_QUERY_PATH || "/query/{platform} (default)",
      CATCHR_AUTH_STYLE: process.env.CATCHR_AUTH_STYLE || "bearer (default)",
      SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01 (default)",
      REPORT_TIMEZONE: process.env.REPORT_TIMEZONE || "UTC (default)",
    },
  };

  if (missing.length) {
    out.hint =
      `Set ${missing.join(", ")} on the Vercel project, then REDEPLOY — ` +
      "environment variables only reach a new deployment, never a running one.";
  }

  // Configuration status is public; account shape and history are not.
  if (!authorized(req)) {
    out.detail = "Pass ?secret=<CRON_SECRET> for connected accounts and recent sync runs.";
    res.status(200).json(out);
    return;
  }

  out.accounts = {
    amazonSeller: SELLER_ACCOUNTS.length,
    amazonAds: AMAZON_ADS_ACCOUNTS.length,
    facebookAds: FACEBOOK_ADS_ACCOUNTS.length,
    googleAds: GOOGLE_ADS_ACCOUNTS.length,
    spapiConfigured: spapiConfigured(),
  };

  try {
    out.recentRuns = await select(
      "sync_runs",
      "select=job,status,rows_written,started_at,finished_at&order=started_at.desc&limit=10",
    );
  } catch (err) {
    out.recentRuns = { error: err.message };
  }

  // The probe exists because Catchr does not publish its REST contract. It
  // tries each plausible (path, auth header) combination against a 1-row
  // query and reports the one that works, so you can pin it in env vars
  // instead of guessing.
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
