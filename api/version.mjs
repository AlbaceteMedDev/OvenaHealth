// The build the server is currently serving.
//
// The portal is static ES modules with no build step, so nothing in the page
// carries a version and module URLs never change. A tab left open therefore
// keeps running whatever JavaScript it loaded first — switching tabs inside
// the app re-mounts them but never re-fetches code — so a deploy could land
// and the person looking at the dashboard would keep seeing the old build
// with no indication anything had changed. That is indistinguishable from
// "the fix didn't work".
//
// Public on purpose: it reveals only a commit sha, which is already public
// in the repo, and gating it would defeat the point of a cheap poll.
export default function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    build:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.VERCEL_DEPLOYMENT_ID ||
      "dev",
  });
}
