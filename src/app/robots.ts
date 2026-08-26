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
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
