import { NextResponse } from "next/server";
import { getScrollytellingData } from "@/lib/landing/scrollytelling";

export const dynamic = "force-dynamic";

/**
 * The long market study is useful but too large for every Pulse visit. Keep it
 * off the initial React Server Component payload and resolve it only when the
 * reader opens that module.
 */
export async function GET() {
  try {
    const data = await getScrollytellingData();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    console.error("[pulse/story] unable to load market study", error);
    return NextResponse.json(
      { error: "Market study unavailable" },
      { status: 503 },
    );
  }
}
