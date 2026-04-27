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
