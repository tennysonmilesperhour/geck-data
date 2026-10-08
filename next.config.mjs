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
  // The site was cut down to a few pages: Price check (home), Morphs,
  // Listings, Breeders, Trends and Markets. Old routes forward to the closest new page so
  // bookmarks and search results keep working. Temporary (307) on purpose,
  // so any of these can come back without browsers having cached the move.
  async redirects() {
    const toMorphs = [
      "/market",
      "/indices",
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
      { source: "/alerts", destination: "/watchlist", permanent: false },
      { source: "/settings", destination: "/", permanent: false },
      { source: "/sold", destination: "/listings?status=sold", permanent: false },
      { source: "/trait/:slug", destination: "/morphs/:slug", permanent: false },
      ...toMorphs.map((source) => ({ source, destination: "/morphs", permanent: false })),
    ];
  },
  // Security headers for every path. Do not set Cache-Control here.
  // A Cache-Control value in headers() replaces the ISR edge cache header
  // Next sets (s-maxage / stale-while-revalidate from the caching work in
  // #129). These entries are merged onto the response and leave that
  // header alone. HSTS matches the value already sent in production.
  //
  // X-Frame-Options is omitted on /embed and /embed/:path* so the market
  // temperature widget can be framed on other sites. Every other header
  // still applies there. No Content-Security-Policy.
  async headers() {
    const headers = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];
    return [
      {
        source: "/:path*",
        headers,
      },
      {
        // Same set as /embed/:path*, which also matches /embed itself.
        // /embedded and other prefixes stay framed only by this origin.
        source: "/((?!embed(?:/|$)).*)",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
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
