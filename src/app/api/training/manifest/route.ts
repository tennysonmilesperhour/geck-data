// Streams a JSONL training manifest for the Morph ID classifier.
//
//   GET /api/training/manifest?split=train|val|test
//
// Reads public.v_morph_training, joins the multi-hot label vector from the
// crested_morph_taxonomy ordering, and streams one record per line. The
// trainer (Python or otherwise) pipes this directly into its data loader
// without ever hitting an in-memory list.
//
// Auth: read-only data through the public-read RLS policies. No
// authentication required — the training set is a derivative of public
// MorphMarket listings and our taxonomy.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TrainingRow = {
  image_url: string;
  listing_id: string;
  traits: string[] | null;
  sex: string | null;
  maturity: string | null;
  price: number | null;
  currency: string | null;
  source: string;
  split: string;
};

const PAGE_SIZE = 1000;

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const split = req.nextUrl.searchParams.get("split") ?? "train";
  if (!["train", "val", "test"].includes(split)) {
    return NextResponse.json(
      { error: "split must be one of: train, val, test" },
      { status: 400 },
    );
  }

  // Pull the taxonomy once so we can build a multi-hot label vector keyed
  // by index. The order matches scripts/export_training_dataset.py exactly.
  const taxRes = await supabase
    .from("crested_morph_taxonomy")
    .select("canonical_name,category")
    .order("category")
    .order("canonical_name");
  const traitNames = (taxRes.data ?? []).map((r) => r.canonical_name);
  const traitIndex = new Map(traitNames.map((n, i) => [n, i]));

  const encoder = new TextEncoder();

  // Stream the rows so we don't materialize the full manifest in memory.
  const stream = new ReadableStream({
    async start(controller) {
      // Header row: include taxonomy info as the first JSON line so the
      // consumer knows what label_order corresponds to.
      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            _meta: true,
            split,
            label_order: traitNames,
            generated_at: new Date().toISOString(),
          }) + "\n",
        ),
      );

      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("v_morph_training")
          .select(
            "image_url,listing_id,traits,sex,maturity,price,currency,source,split",
          )
          .eq("split", split)
          .not("image_url", "is", null)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ _error: error.message }) + "\n"),
          );
          break;
        }
        const rows = (data ?? []) as TrainingRow[];
        if (rows.length === 0) break;
        for (const r of rows) {
          const traits = r.traits ?? [];
          if (traits.length === 0) continue;
          const labels = new Array(traitNames.length).fill(0);
          for (const t of traits) {
            const idx = traitIndex.get(t);
            if (idx !== undefined) labels[idx] = 1;
          }
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                image_url: r.image_url,
                listing_id: r.listing_id,
                traits,
                labels,
                sex: r.sex,
                maturity: r.maturity,
                price: r.price,
                currency: r.currency,
                source: r.source,
                split: r.split,
              }) + "\n",
            ),
          );
        }
        if (rows.length < PAGE_SIZE) break;
        offset += rows.length;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="morph-id-${split}.jsonl"`,
      "Cache-Control": "no-store",
    },
  });
}
