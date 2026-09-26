/** @type {import('next').NextConfig} */

// Identifier for the build currently being compiled. On Vercel this is the
// git commit SHA of the deploy; locally it falls back to "dev". It gets
// inlined into the client bundle as NEXT_PUBLIC_BUILD_ID (see `env` below)
// and compared at runtime against /api/version, which reports the SHA of
// whichever deployment is *currently* serving production, so a browser
// left open on a stale deploy can prompt the user to refresh.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  "dev";

const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "d2bjn9a420fiq0.cloudfront.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "mmuglfphhwlaluyfyxsp.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // The site was cut down to four pages: Price check (home), Morphs,
  // Listings and Breeders. Old routes forward to the closest new page so
  // bookmarks and search results keep working. Temporary (307) on purpose,
  // so any of these can come back without browsers having cached the move.
  async redirects() {
    const toMorphs = [
      "/market",
      "/indices",
      "/trends",
      "/compare",
      "/reports",
      "/reports/:path*",
      "/shows",
      "/cross-platform",
      "/price-drops",
      "/daily-log",
      "/region/:path*",
    ];
    return [
      { source: "/whats-it-worth", destination: "/", permanent: false },
      { source: "/sold", destination: "/listings?status=sold", permanent: false },
      { source: "/trait/:slug", destination: "/morphs/:slug", permanent: false },
      ...toMorphs.map((source) => ({ source, destination: "/morphs", permanent: false })),
    ];
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
