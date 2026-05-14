// JSON dump of crested_morph_taxonomy ordered identically to the manifest's
// label_order vector. Linked from the /data-admin/training page so the
// trainer can fetch the canonical trait set as a static asset.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("crested_morph_taxonomy")
    .select("canonical_name,norm_name,category,synonyms")
    .order("category")
    .order("canonical_name");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const traits = data ?? [];
  return NextResponse.json(
    {
      version: new Date().toISOString(),
      traits,
      label_order: traits.map((t) => t.canonical_name),
    },
    {
      headers: {
        "Content-Disposition": 'attachment; filename="morph-id-taxonomy.json"',
        "Cache-Control": "no-store",
      },
    },
  );
}
