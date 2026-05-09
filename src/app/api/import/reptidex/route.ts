// ReptiDex importer.
//
// ReptiDex (reptidex.com) publishes structured leopard gecko genetics:
// alleles, inheritance modes, parent morphs, synonyms. There is no
// documented public API, so we scrape the per-morph pages, parse the
// embedded JSON-LD / data-attributes, and upsert into morph_taxonomy.
//
// Lightweight + bounded: this importer only writes to morph_taxonomy. It
// does not download any image content; reference photos for these morphs
// come from the wiki + breeder partnerships.
//
// Auth: INGEST_API_KEY.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedImporter } from "@/lib/ingest/importerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Curated seed list of slugs we want to ingest. ReptiDex changes infrequently
// enough that hardcoding the set we care about is more reliable than relying
// on a dynamic index page.
const SLUGS = [
  "albino-tremper",
  "albino-bell",
  "albino-rainwater",
  "blizzard",
  "eclipse",
  "mack-snow",
  "super-snow",
  "enigma",
  "white-knight",
  "diablo-blanco",
  "marble-eye",
  "raptor",
  "stealth",
  "dreamsicle",
  "sunglow",
  "tangerine",
  "carrot-tail",
  "patternless",
  "murphy-patternless",
];

const BASE = "https://reptidex.com/genetics/leopard-gecko";

function normMorph(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1]);
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          if (x && typeof x === "object" && !Array.isArray(x)) {
            out.push(x as Record<string, unknown>);
          }
        }
      } else if (parsed && typeof parsed === "object") {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed
    }
  }
  return out;
}

function extractMeta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const m = re.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

function extractFirstHeading(html: string): string | null {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return null;
  return decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim();
}

function extractInheritance(html: string): string | null {
  // ReptiDex morph pages tag inheritance with class names like
  // "trait-inheritance" or labeled <dt>/<dd> pairs. Try a few patterns.
  const labeled = /Inheritance[^<]*<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/i.exec(html);
  if (labeled) return decodeEntities(labeled[1]).trim();
  const cls = /class=["'][^"']*trait-inheritance[^"']*["'][^>]*>([^<]+)/i.exec(html);
  if (cls) return decodeEntities(cls[1]).trim();
  return null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedImporter(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(SLUGS.length, Number(url.searchParams.get("limit") ?? "8")));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0"));
  const slugs = SLUGS.slice(offset, offset + limit);

  const admin = createAdminClient();
  const rows: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const slug of slugs) {
    const pageUrl = `${BASE}/${slug}`;
    try {
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": "geck-inspect-importer/1.0 (contact via geckinspect.com)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        errors.push(`${slug}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();

      // Prefer JSON-LD if it exposes the morph data; fall back to meta tags
      // and DOM heuristics. Either way, slug is the canonical key.
      const ld = extractJsonLd(html);
      const main = ld.find((x) => {
        const t = x["@type"];
        return typeof t === "string" && /thing|article|definedterm/i.test(t);
      });

      const canonicalName =
        (main?.name as string | undefined) ??
        extractFirstHeading(html) ??
        slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const description =
        (main?.description as string | undefined) ??
        extractMeta(html, "og:description") ??
        extractMeta(html, "description");
      const inheritance = extractInheritance(html);

      rows.push({
        species: "Eublepharis macularius",
        canonical_name: canonicalName,
        norm_name: normMorph(canonicalName),
        inheritance,
        allele_group: null,
        parent_morphs: null,
        synonyms: null,
        description: description?.slice(0, 4000) ?? null,
        source_kind: "reptidex",
        source_id: slug,
        source_url: pageUrl,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      errors.push(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, errors, next_offset: offset + limit });
  }

  const { error, count } = await admin
    .from("morph_taxonomy")
    .upsert(rows, {
      onConflict: "species,norm_name,source_kind",
      count: "exact",
    });
  if (error) {
    return NextResponse.json(
      { error: error.message, attempted: rows.length, errors },
      { status: 500 },
    );
  }

  return NextResponse.json({
    inserted: count ?? rows.length,
    errors,
    next_offset: offset + limit < SLUGS.length ? offset + limit : null,
  });
}
