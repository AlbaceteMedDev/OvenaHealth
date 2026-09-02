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
import { isConfigured as shopifyConfigured, shopName } from "./_lib/shopify.mjs";
import { REPORT_TZ } from "../js/config.js";

// Without these the sync cannot run at all.
const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CATCHR_API_KEY", "CRON_SECRET"];

// Each of these unlocks one tab; absence degrades rather than breaks.
//
// `configured` is the verdict; the per-variable booleans are the worksheet.
// They answer different questions, and reading the worksheet as the verdict
// is actively misleading for Shopify: the sync accepts EITHER a long-lived
// SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET to mint
// one per run. Minting is the durable choice — a token pasted from the
// client_credentials grant dies after 24h and then 401s on every run — so a
// correctly configured store reports SHOPIFY_ADMIN_TOKEN: false on purpose.
// Publishing only the flat list made that healthy state read as a fault.
//
// Each `configured` delegates to the very predicate its sync gates on, so
// this endpoint cannot drift from what the sync actually does.
const OPTIONAL = {
  shopify: {
    vars: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"],
    configured: shopifyConfigured,
  },
  fbaInventory: {
    vars: ["SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN"],
    configured: spapiConfigured,
  },
};

const isSet = (name) => Boolean(process.env[name]);

export default async function handler(req, res) {
  const missing = REQUIRED.filter((name) => !isSet(name));

  const out = {
    ready: missing.length === 0,
    missing,
    required: Object.fromEntries(REQUIRED.map((name) => [name, isSet(name)])),
    optional: Object.fromEntries(
      Object.entries(OPTIONAL).map(([feature, { vars, configured }]) => [
        feature,
        {
          configured: configured(),
          ...Object.fromEntries(vars.map((name) => [name, isSet(name)])),
        },
      ]),
    ),
    defaults: {
      CATCHR_API_BASE: process.env.CATCHR_API_BASE || "https://api.catchr.io (default)",
      CATCHR_QUERY_PATH: process.env.CATCHR_QUERY_PATH || "/query/{platform} (default)",
      CATCHR_AUTH_STYLE: process.env.CATCHR_AUTH_STYLE || "bearer (default)",
      SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2025-01 (default)",
      REPORT_TIMEZONE: process.env.REPORT_TIMEZONE || `${REPORT_TZ} (default)`,
    },
  };

  if (missing.length) {
    out.hint =
      `Set ${missing.join(", ")} on the Vercel project, then REDEPLOY — ` +
      "environment variables only reach a new deployment, never a running one.";
  }

  // ?probe=shopify makes one real call. "configured" only says the variables
  // exist; this says whether Shopify accepts them right now.
  const url = new URL(req.url, "http://localhost");
  if (url.searchParams.get("probe") === "shopify") {
    try {
      const shop = await shopName();
      out.probe = { shopify: { ok: !!shop, shop: shop?.name || null } };
    } catch (err) {
      out.probe = { shopify: { ok: false, error: String(err.message).slice(0, 200) } };
    }
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
