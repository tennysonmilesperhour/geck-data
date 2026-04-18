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
};
export default nextConfig;
