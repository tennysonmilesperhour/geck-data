// Leopard Gecko Wiki importer.
//
// Pulls morph pages from leopardgeckowiki.com via the standard MediaWiki API.
// Each page contributes:
//   - one row in morph_taxonomy (canonical morph name + inheritance + synonyms)
//   - one row per page-image in external_reference_images, labeled with the
//     page's morph name. Wiki photos are user-uploaded under the wiki's
//     license (typically CC-BY-SA); we record the license string verbatim.
//
// MediaWiki API: https://www.leopardgeckowiki.com/api.php
// Auth: INGEST_API_KEY.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedImporter } from "@/lib/ingest/importerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WIKI_API = "https://www.leopardgeckowiki.com/api.php";
const MORPHS_CATEGORY = "Category:Morphs";
const PAGE_BATCH = 10;

function normMorph(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function wikiGet<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(WIKI_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "geck-inspect-importer/1.0 (contact via geckinspect.com)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  return (await res.json()) as T;
}

type CategoryMembers = {
  query?: { categorymembers?: Array<{ pageid: number; title: string }> };
  continue?: { cmcontinue?: string };
};
type ImageInfo = {
  url?: string;
  width?: number;
  height?: number;
  extmetadata?: {
    LicenseShortName?: { value?: string };
    Artist?: { value?: string };
  };
};
type PageInfo = {
  pageid?: number;
  title?: string;
  fullurl?: string;
  extract?: string;
  images?: Array<{ title: string }>;
};
type PageQuery = { query?: { pages?: Record<string, PageInfo> } };
type ImageQuery = { query?: { pages?: Record<string, { imageinfo?: ImageInfo[] }> } };

export async function GET(req: NextRequest) {
  if (!isAuthorizedImporter(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const cmcontinue = url.searchParams.get("cursor") ?? undefined;
  const admin = createAdminClient();

  let pages: Array<{ pageid: number; title: string }> = [];
  let nextCursor: string | null = null;
  try {
    const cm = await wikiGet<CategoryMembers>({
      action: "query",
      list: "categorymembers",
      cmtitle: MORPHS_CATEGORY,
      cmlimit: String(PAGE_BATCH),
      ...(cmcontinue ? { cmcontinue } : {}),
    });
    pages = cm.query?.categorymembers ?? [];
    nextCursor = cm.continue?.cmcontinue ?? null;
  } catch (e) {
    return NextResponse.json(
      { error: `category fetch: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  let taxonomyInserted = 0;
  let imagesInserted = 0;
  const errors: string[] = [];

  for (const page of pages) {
    try {
      const pq = await wikiGet<PageQuery>({
        action: "query",
        prop: "extracts|images|info",
        inprop: "url",
        explaintext: "1",
        exsectionformat: "plain",
        exintro: "1",
        pageids: String(page.pageid),
      });
      const info = pq.query?.pages?.[String(page.pageid)];
      if (!info?.title) continue;

      // Taxonomy row.
      const taxRow = {
        species: "Eublepharis macularius",
        canonical_name: info.title,
        norm_name: normMorph(info.title),
        inheritance: null,
        allele_group: null,
        parent_morphs: null,
        synonyms: null,
        description: info.extract?.slice(0, 4000) ?? null,
        source_kind: "leopard_gecko_wiki",
        source_id: String(info.pageid ?? page.pageid),
        source_url: info.fullurl ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error: tErr } = await admin
        .from("morph_taxonomy")
        .upsert(taxRow, { onConflict: "species,norm_name,source_kind" });
      if (tErr) {
        errors.push(`${info.title}: taxonomy upsert: ${tErr.message}`);
        continue;
      }
      taxonomyInserted++;

      // Image rows. Each page lists its images by File:Name.png; we then
      // resolve imageinfo (real URL + license) in a single follow-up query.
      const imageTitles = (info.images ?? [])
        .map((i) => i.title)
        .filter((t) => /\.(jpe?g|png|webp)$/i.test(t));
      if (imageTitles.length === 0) continue;

      const iq = await wikiGet<ImageQuery>({
        action: "query",
        prop: "imageinfo",
        iiprop: "url|size|extmetadata",
        titles: imageTitles.join("|"),
      });
      const imagePages = Object.values(iq.query?.pages ?? {});
      const imgRows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < imagePages.length; i++) {
        const ii = imagePages[i].imageinfo?.[0];
        if (!ii?.url) continue;
        const license = ii.extmetadata?.LicenseShortName?.value ?? null;
        const artist = ii.extmetadata?.Artist?.value ?? null;
        imgRows.push({
          source_kind: "leopard_gecko_wiki",
          source_id: `page-${page.pageid}-${normMorph(imageTitles[i])}`,
          source_url: info.fullurl ?? null,
          species: "Eublepharis macularius",
          morph_label: info.title,
          norm_morph_label: normMorph(info.title),
          license,
          attribution: artist?.replace(/<[^>]+>/g, "") ?? null,
          image_url: ii.url,
          width: ii.width ?? null,
          height: ii.height ?? null,
          raw: { file_title: imageTitles[i] },
        });
      }
      if (imgRows.length) {
        const { error: iErr, count } = await admin
          .from("external_reference_images")
          .upsert(imgRows, {
            onConflict: "source_kind,source_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (iErr) {
          errors.push(`${info.title}: images upsert: ${iErr.message}`);
        } else {
          imagesInserted += count ?? imgRows.length;
        }
      }
    } catch (e) {
      errors.push(`${page.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    pages_processed: pages.length,
    taxonomy_upserted: taxonomyInserted,
    images_inserted: imagesInserted,
    next_cursor: nextCursor,
    errors,
  });
}
