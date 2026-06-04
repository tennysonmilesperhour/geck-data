// Reports the build identifier of the deployment currently handling the
// request. Read from the runtime environment (NOT inlined at build time) so
// that once a new production deployment goes live, this endpoint — served by
// that new deployment — returns the new SHA. The client compares it against
// the NEXT_PUBLIC_BUILD_ID baked into its bundle to detect a stale tab.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    "dev";

  return NextResponse.json(
    { buildId },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
