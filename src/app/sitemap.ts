import type { MetadataRoute } from "next";
import { getMorphs } from "@/lib/simple/data";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://geck-data.vercel.app"
).replace(/\/$/, "");

const PUBLIC_ROUTES = [
  "",
  "/morphs",
  "/listings",
  "/sellers",
  "/methodology",
  "/status",
  "/api-docs",
] as const;

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const morphs = await getMorphs();
  return [
    ...PUBLIC_ROUTES.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.7,
    })),
    ...morphs.map((m) => ({
      url: `${SITE_URL}/morphs/${m.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
