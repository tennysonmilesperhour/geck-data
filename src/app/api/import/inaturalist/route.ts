// iNaturalist importer.
//
// Pulls research-grade observations of Eublepharis macularius (leopard gecko)
// and Correlophus ciliatus (crested gecko) and stores their CC-licensed photos
// as wild-type / non-morph reference images. iNat photos are not morph-labeled
// in any structured way, so these rows are intentionally morph_label=null;
// they serve as a wild-type negative class for the morph ID model so it stops
// hallucinating named morphs on plain captive-bred yellow geckos.
//
// API: https://api.inaturalist.org/v1/observations
// Terms: photos are individually licensed; we filter to CC-licensed only and
// store the per-photo license + attribution string verbatim.
//
// Auth: same INGEST_API_KEY as /api/ingest. Vercel cron friendly (small
// batch per call, idempotent via external_reference_images.unique key).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedImporter } from "@/lib/ingest/importerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Taxon IDs from iNat; cheaper than name resolution per call.
const TAXA: Array<{ taxon_id: number; species: string }> = [
  { taxon_id: 36116, species: "Eublepharis macularius" },
  { taxon_id: 36161, species: "Correlophus ciliatus" },
];

const PER_PAGE = 50; // bounded so each cron tick is short
const ALLOWED_LICENSES = new Set(["cc0", "cc-by", "cc-by-nc", "cc-by-sa", "cc-by-nc-sa"]);

type ObservationPhoto = {
  id?: number;
  url?: string;
  license_code?: string | null;
  attribution?: string | null;
  original_dimensions?: { width?: number; height?: number } | null;
};
type Observation = {
  id?: number;
  uri?: string;
  observed_on?: string | null;
  photos?: ObservationPhoto[];
  taxon?: { id?: number; name?: string };
  user?: { login?: string };
};

function urlFromPhoto(p: ObservationPhoto): string | null {
  if (!p.url) return null;
  // iNat URLs are square thumbs by default; swap to "large" for usable
  // training input. Pattern: .../square.jpg -> .../large.jpg.
  return p.url.replace(/\/square\./, "/large.");
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedImporter(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const taxonIdParam = url.searchParams.get("taxon_id");
  const targets = taxonIdParam
    ? TAXA.filter((t) => String(t.taxon_id) === taxonIdParam)
    : TAXA;
  if (targets.length === 0) {
    return NextResponse.json({ error: "unknown taxon_id" }, { status: 400 });
  }

  const admin = createAdminClient();
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const taxon of targets) {
    const apiUrl = new URL("https://api.inaturalist.org/v1/observations");
    apiUrl.searchParams.set("taxon_id", String(taxon.taxon_id));
    apiUrl.searchParams.set("photos", "true");
    apiUrl.searchParams.set("quality_grade", "research");
    apiUrl.searchParams.set("per_page", String(PER_PAGE));
    apiUrl.searchParams.set("page", String(page));
    apiUrl.searchParams.set("order_by", "observed_on");

    let res: Response;
    try {
      res = await fetch(apiUrl.toString(), {
        headers: { "User-Agent": "geck-inspect-importer/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      errors.push(`${taxon.species}: fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!res.ok) {
      errors.push(`${taxon.species}: HTTP ${res.status}`);
      continue;
    }
    const json = (await res.json()) as { results?: Observation[] };
    const observations = Array.isArray(json.results) ? json.results : [];

    const rows: Array<Record<string, unknown>> = [];
    for (const obs of observations) {
      if (!obs.id || !Array.isArray(obs.photos)) continue;
      for (const photo of obs.photos) {
        const license = (photo.license_code ?? "").toLowerCase();
        if (!ALLOWED_LICENSES.has(license)) {
          skipped++;
          continue;
        }
        const imageUrl = urlFromPhoto(photo);
        if (!imageUrl || !photo.id) continue;
        rows.push({
          source_kind: "inaturalist",
          source_id: `obs-${obs.id}-photo-${photo.id}`,
          source_url: obs.uri ?? `https://www.inaturalist.org/observations/${obs.id}`,
          species: taxon.species,
          morph_label: null,
          norm_morph_label: "wild_type",
          license,
          attribution: photo.attribution ?? null,
          image_url: imageUrl,
          width: photo.original_dimensions?.width ?? null,
          height: photo.original_dimensions?.height ?? null,
          captured_at: obs.observed_on ? `${obs.observed_on}T00:00:00Z` : null,
          raw: { obs_id: obs.id, photo_id: photo.id, user: obs.user?.login },
        });
      }
    }

    if (rows.length === 0) continue;

    const { error, count } = await admin
      .from("external_reference_images")
      .upsert(rows, {
        onConflict: "source_kind,source_id",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) {
      errors.push(`${taxon.species}: upsert failed: ${error.message}`);
      continue;
    }
    inserted += count ?? rows.length;
  }

  return NextResponse.json({
    page,
    inserted,
    skipped_non_cc: skipped,
    errors,
  });
}
