import type { MetadataRoute } from "next";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://geck-data.vercel.app"
).replace(/\/$/, "");

const PUBLIC_ROUTES = [
  "",
  "/api-docs",
  "/compare",
  "/cross-platform",
  "/daily-log",
  "/indices",
  "/market",
  "/methodology",
  "/price-drops",
  "/reports",
  "/sellers",
  "/shows",
  "/sold",
  "/status",
  "/trends",
  "/whats-it-worth",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" || path === "/sold" ? "daily" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
