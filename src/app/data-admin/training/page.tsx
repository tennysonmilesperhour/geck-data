// Morph ID training console — server-rendered dataset summary plus
// download links for the JSONL manifest and JSON taxonomy.
//
// Pulls counts straight from v_morph_training_stats (defined in 0014) so
// the page reflects whatever the daily scrape just landed.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

type StatRow = {
  kind: "split" | "trait";
  key: string;
  image_count: number;
  listing_count: number | null;
};

type ExampleImage = {
  image_url: string;
  listing_id: string;
};

export default async function MorphIdTrainingPage() {
  const supabase = createClient();

  const [statsRes, taxRes] = await Promise.all([
    supabase
      .from("v_morph_training_stats")
      .select("kind,key,image_count,listing_count")
      .limit(2000),
    supabase
      .from("crested_morph_taxonomy")
      .select("canonical_name,norm_name,category,synonyms")
      .order("category")
      .order("canonical_name"),
  ]);

  const stats = (statsRes.data ?? []) as StatRow[];
  const splits = stats
    .filter((s) => s.kind === "split")
    .sort((a, b) =>
      a.key === "train" ? -1 : b.key === "train" ? 1 : a.key.localeCompare(b.key),
    );
  const traits = stats
    .filter((s) => s.kind === "trait")
    .sort((a, b) => b.image_count - a.image_count);
  const totalImages = splits.reduce((sum, s) => sum + s.image_count, 0);
  const maxTraitImages = Math.max(...traits.map((t) => t.image_count), 1);
  const taxonomy = taxRes.data ?? [];

  // Pull a couple of example images per top trait so we can illustrate.
  const topTraitNames = traits.slice(0, 8).map((t) => t.key);
  const examplesByTrait = new Map<string, ExampleImage[]>();
  if (topTraitNames.length > 0) {
    const exQ = await supabase
      .from("v_morph_training")
      .select("image_url, listing_id, traits")
      .eq("split", "train")
      .overlaps("traits", topTraitNames)
      .limit(200);
    for (const row of (exQ.data ?? []) as Array<{
      image_url: string;
      listing_id: string;
      traits: string[] | null;
    }>) {
      const t = (row.traits ?? [])[0];
      if (!t || !topTraitNames.includes(t)) continue;
      const arr = examplesByTrait.get(t) ?? [];
      if (arr.length < 4) arr.push({ image_url: row.image_url, listing_id: row.listing_id });
      examplesByTrait.set(t, arr);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
          Dataset
        </div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink-50">
          Morph ID training set
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-300">
          Multi-label classification dataset built from the daily MorphMarket
          scrape. Each image carries a list of canonical crested gecko traits
          from <code className="text-ink-100">crested_morph_taxonomy</code> and
          a deterministic train/val/test split keyed on listing_id.
        </p>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Splits
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <SplitCard label="Total" value={totalImages} accent="default" />
          {splits.map((s) => (
            <SplitCard
              key={s.key}
              label={s.key}
              value={s.image_count}
              accent={s.key === "train" ? "emerald" : s.key === "val" ? "sky" : "amber"}
              ratio={totalImages > 0 ? s.image_count / totalImages : 0}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Download
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <DownloadCard
            href="/api/training/manifest?split=train"
            title="train.jsonl"
            sub={`${fmtInt(splits.find((s) => s.key === "train")?.image_count ?? 0)} images`}
          />
          <DownloadCard
            href="/api/training/manifest?split=val"
            title="val.jsonl"
            sub={`${fmtInt(splits.find((s) => s.key === "val")?.image_count ?? 0)} images`}
          />
          <DownloadCard
            href="/api/training/manifest?split=test"
            title="test.jsonl"
            sub={`${fmtInt(splits.find((s) => s.key === "test")?.image_count ?? 0)} images`}
          />
          <DownloadCard
            href="/api/training/taxonomy"
            title="taxonomy.json"
            sub={`${taxonomy.length} canonical traits`}
          />
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Manifests are streamed NDJSON. First line is a metadata record with{" "}
          <code className="text-ink-200">label_order</code>; subsequent lines
          are one training example each with a multi-hot{" "}
          <code className="text-ink-200">labels</code> vector indexed in the
          same order. See{" "}
          <code className="text-ink-200">scripts/export_training_dataset.py</code>{" "}
          for a Python equivalent and{" "}
          <code className="text-ink-200">scripts/train_morph_classifier.py</code>{" "}
          for a starter PyTorch trainer.
        </p>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Per-trait coverage
        </h3>
        <div className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
          {traits.length === 0 ? (
            <div className="text-sm text-ink-400">No traits in the dataset yet.</div>
          ) : (
            <ol className="space-y-1.5">
              {traits.map((t) => (
                <li key={t.key} className="relative overflow-hidden rounded px-2 py-1.5">
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-emerald-500/[0.08]"
                    style={{ width: `${(t.image_count / maxTraitImages) * 100}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-ink-100">{t.key}</span>
                    <span className="font-mono text-[11px] tabular-nums text-ink-300">
                      {fmtInt(t.image_count)} img
                      <span className="ml-3 text-ink-500">
                        {fmtInt(t.listing_count ?? 0)} listings
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Examples by trait
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {topTraitNames.map((trait) => {
            const examples = examplesByTrait.get(trait) ?? [];
            return (
              <div
                key={trait}
                className="rounded-xl border border-ink-700 bg-ink-850 p-3"
              >
                <div className="mb-2 flex items-baseline justify-between">
                  <div className="text-sm font-medium text-ink-100">{trait}</div>
                  <div className="font-mono text-[10px] text-ink-500">
                    {fmtInt(traits.find((t) => t.key === trait)?.image_count ?? 0)} images
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {examples.length === 0
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="aspect-square rounded-md border border-dashed border-ink-700/60 bg-ink-900"
                        />
                      ))
                    : examples.map((ex, i) => (
                        <Link
                          key={i}
                          href={`/listings/${ex.listing_id}`}
                          className="group relative aspect-square overflow-hidden rounded-md border border-ink-700/60"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ex.image_url}
                            alt={trait}
                            loading="lazy"
                            className="h-full w-full object-cover transition group-hover:scale-105"
                          />
                        </Link>
                      ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          <span>Connect to geck-inspect Morph ID</span>
          <Link
            href="/data-admin/training/evals"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20"
          >
            View eval runs →
          </Link>
        </h3>
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-5 text-sm">
          <p className="text-ink-300">
            The Morph ID tool lives in the <code className="text-ink-100">geck-inspect</code> repo
            as a Supabase edge function (<code className="text-ink-100">recognize-gecko-morph</code>)
            powered by Claude Vision. It reads its &quot;ground truth&quot; from{" "}
            <code className="text-ink-100">geck-inspect.gecko_images</code>, a separate Supabase
            project. Two scripts bridge the two databases:
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-ink-700/60 bg-ink-900/40 p-3">
              <div className="font-mono text-xs text-emerald-300">
                scripts/seed_geck_inspect.py
              </div>
              <p className="mt-1 text-xs text-ink-400">
                Pushes wild scraper images into <code>gecko_images</code> with
                {" "}<code>verified=false</code>, taxonomy-aligned labels, and
                provenance tags. They land in the reviewer queue for expert
                verification.
              </p>
            </div>
            <div className="rounded-lg border border-ink-700/60 bg-ink-900/40 p-3">
              <div className="font-mono text-xs text-sky-300">
                scripts/eval_morph_id.py
              </div>
              <p className="mt-1 text-xs text-ink-400">
                Runs the edge function over our test split and reports
                top-1 accuracy on primary_morph plus Jaccard on
                genetic_traits.
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Both scripts require <code>GECK_INSPECT_SUPABASE_URL</code> +{" "}
            <code>GECK_INSPECT_SUPABASE_SERVICE_KEY</code> for the seeder and{" "}
            <code>GECK_INSPECT_FUNCTION_URL</code> +{" "}
            <code>GECK_INSPECT_ANON_KEY</code> for the eval.
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Taxonomy
        </h3>
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-left font-mono text-[10px] uppercase tracking-wider text-ink-400">
              <tr>
                <th className="px-3 py-2">Index</th>
                <th className="px-3 py-2">Canonical name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Synonyms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {taxonomy.map((t, i) => (
                <tr key={t.canonical_name} className="hover:bg-ink-850">
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-500">{i}</td>
                  <td className="px-3 py-2 text-ink-100">{t.canonical_name}</td>
                  <td className="px-3 py-2 text-ink-300">{t.category}</td>
                  <td className="px-3 py-2 text-xs text-ink-400">
                    {(t.synonyms ?? []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SplitCard({
  label,
  value,
  ratio,
  accent,
}: {
  label: string;
  value: number;
  ratio?: number;
  accent: "default" | "emerald" | "sky" | "amber";
}) {
  const accentClasses = {
    default: "border-ink-700 text-ink-50",
    emerald: "border-emerald-500/40 text-emerald-200",
    sky: "border-sky-500/40 text-sky-200",
    amber: "border-amber-500/40 text-amber-200",
  }[accent];
  return (
    <div className={`rounded-xl border bg-ink-850 p-4 ${accentClasses}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">
        {fmtInt(value)}
      </div>
      {ratio !== undefined ? (
        <div className="mt-1 font-mono text-[10px] text-ink-400">
          {(ratio * 100).toFixed(1)}%
        </div>
      ) : null}
    </div>
  );
}

function DownloadCard({
  href,
  title,
  sub,
}: {
  href: string;
  title: string;
  sub: string;
}) {
  return (
    <a
      href={href}
      download
      className="group flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 transition hover:border-emerald-500/40 hover:bg-ink-800"
    >
      <div>
        <div className="font-mono text-sm text-ink-100 group-hover:text-emerald-100">
          {title}
        </div>
        <div className="text-xs text-ink-400">{sub}</div>
      </div>
      <span aria-hidden className="text-ink-400 group-hover:text-emerald-200">
        ↓
      </span>
    </a>
  );
}
