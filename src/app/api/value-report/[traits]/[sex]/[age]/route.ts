import { getMorphs } from "@/lib/simple/data";
import { loadValueReport } from "@/lib/simple/report";
import { stateFromReportPath } from "@/lib/simple/report-state";

// One hour, matching the homepage. Unknown trait/sex/age combos are rendered
// on the first request and then kept at the edge. The path is the cache key,
// so reading the query string (which would force no-store) is avoided.
export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [{ traits: "-", sex: "-", age: "-" }];
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ traits: string; sex: string; age: string }> },
) {
  const { traits, sex, age } = await context.params;
  if (traits.length > 200 || sex.length > 20 || age.length > 20) {
    return Response.json({ error: "bad request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const morphs = await getMorphs();
  if (!morphs.length) {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const report = await loadValueReport(stateFromReportPath(traits, sex, age), morphs);
  return Response.json(report);
}
