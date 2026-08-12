// Shared guard for the sync routes and the gated half of /api/health.
//
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically once
// CRON_SECRET is set on the project — that is the only mechanism Vercel
// documents (vercel.com/docs/cron-jobs/manage-cron-jobs). The ?secret= form
// exists so a run can be kicked off by hand from a browser.
//
// There is deliberately NO fallback for "CRON_SECRET is unset". Vercel tags
// cron invocations with a `vercel-cron/1.0` user agent and it is tempting to
// treat that as proof of origin, but it is an undocumented header and a plain
// string any caller can send: not stable enough to depend on, not strong
// enough to protect a route that writes to the database. Unset means closed.
export function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  if ((req.headers?.authorization || "") === `Bearer ${secret}`) return true;

  return new URL(req.url, "http://localhost").searchParams.get("secret") === secret;
}

export const UNAUTHORIZED =
  "Unauthorized. Set CRON_SECRET on the Vercel project, then pass it as " +
  "?secret=… or an Authorization: Bearer header. " +
  "GET /api/health (no secret needed) shows which variables are still missing.";
