import { getMarketWeekly, getMorphs } from "@/lib/simple/data";

// Weekly market series for one morph. The markets page itself is static;
// choosing a morph fetches this and the edge keeps each morph for an hour.
export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [{ slug: "all" }];
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  if (slug !== "all" && !/^[a-z0-9-]{1,80}$/.test(slug)) {
    return Response.json({ error: "bad request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const morphs = await getMorphs();
  if (!morphs.length) {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const trait = slug === "all" ? null : morphs.find((m) => m.slug === slug)?.trait ?? null;
  if (slug !== "all" && !trait) {
    return Response.json({ trait: null, weeks: [] });
  }

  const weeks = await getMarketWeekly(trait);
  return Response.json({ trait, weeks });
}
