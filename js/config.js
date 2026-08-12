// Public configuration. The anon key is meant to be exposed to the browser —
// it only allows operations permitted by row-level security policies on the
// Supabase project. Never put the service_role key here.

export const SUPABASE_URL = "https://kjeeecazoromscgttggx.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqZWVlY2F6b3JvbXNjZ3R0Z2d4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNzQwOTcsImV4cCI6MjA5Mjg1MDA5N30." +
  "nLKB7WKXCq_49LhpDl0rzRMV1IUwfcvI_rs_z8CLPks";

// All sign-ins use this single shared service email; users only ever type
// the team password. We never send mail to this address — it's a stable
// identifier for the shared workspace account in Supabase Auth.
export const TEAM_EMAIL = "team@ovenahealth.app";

// ─── Reporting window floor ──────────────────────────────────────────
// No tab reports on anything before this date. Everything earlier is
// pre-relaunch and would distort trends and totals.
//
// This is enforced in one place — js/data/live.js clamps every query's
// start date to it, and the sync jobs refuse to backfill past it. Change
// it here and the whole portal moves.
export const DATA_START = "2026-07-19";

// ─── Excluded products ───────────────────────────────────────────────
// Juzo is a third-party brand we no longer carry — the four listings were
// archived in Shopify on 2026-08-12 after a 16-day trial (6 orders, $230,
// all in Jul 6–21). Their revenue is stripped from every channel tab so
// product mix and totals reflect the Ovena Health line only.
//
// Matched case-insensitively against product title. Kept as a pattern
// rather than a fixed ID list so a re-added Juzo SKU can't slip back in.
export const EXCLUDED_PRODUCT_PATTERNS = [/juzo/i];

export function isExcludedProduct(title) {
  if (!title) return false;
  return EXCLUDED_PRODUCT_PATTERNS.some((re) => re.test(title));
}
