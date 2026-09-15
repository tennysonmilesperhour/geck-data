import type { MetadataRoute } from "next";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://geck-data.vercel.app"
).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/alerts",
        "/api/",
        "/data-admin",
        "/upload",
        "/watchlist",
        // TEMPORARY (2026-09-15): emergency brake on the Supabase Disk IO
        // budget. /combo and /trait are combinatorial page spaces, and their
        // internal links carry filter state, so a crawler walks thousands of
        // distinct URLs. Every one of those was a full set of uncached market
        // queries, which drained the IO budget over six days.
        //
        // Page-level caching and a database-side precompute landed with this
        // change, so once the budget has recovered, narrow this to the
        // filtered variants and let the canonical pages back into the index:
        //   "/combo/*?*", "/trait/*?*"
        // A per-URL cache only helps repeat hits, so blocking the filter
        // permutations is what actually bounds a one-pass crawl. Leaving the
        // blanket rule below in place will deindex these pages entirely.
        "/combo",
        "/trait",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
