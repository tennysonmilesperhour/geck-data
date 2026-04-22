/** @type {import('next').NextConfig} */
const nextConfig = {
  // sql.js ships a .wasm file; we load it from its CDN at runtime (see
  // src/lib/ingest/parseSqlite.ts) so we don't need Webpack asset plumbing.
  webpack: (config) => {
    // sql.js uses the `fs` module when running in Node; we only use it
    // server-side, so this fallback is safe.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
  // CORS for the public market snapshot under /data/*. geck-inspect fetches
  // /data/market.json cross-origin; static files bypass middleware (matcher
  // excludes paths with dots), so headers have to be declared here. The
  // snapshot is fully public, read-only, and carries no credentials —
  // `Access-Control-Allow-Origin: *` is the right level of openness.
  async headers() {
    return [
      {
        source: "/data/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" },
        ],
      },
    ];
  },
};
export default nextConfig;
