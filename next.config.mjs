/** @type {import('next').NextConfig} */

// Identifier for the build currently being compiled. On Vercel this is the
// git commit SHA of the deploy; locally it falls back to "dev". It gets
// inlined into the client bundle as NEXT_PUBLIC_BUILD_ID (see `env` below)
// and compared at runtime against /api/version — which reports the SHA of
// whichever deployment is *currently* serving production — so a browser
// left open on a stale deploy can prompt the user to refresh.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  "dev";

const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  // sql.js ships a .wasm file; we load it from its CDN at runtime (see
  // src/lib/ingest/parseSqlite.ts) so we don't need Webpack asset plumbing.
  webpack: (config) => {
    // sql.js uses the `fs` module when running in Node; we only use it
    // server-side, so this fallback is safe.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};
export default nextConfig;
