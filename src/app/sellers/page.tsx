// Breeders directory. Answers what a buyer asks before messaging a store:
// who focuses on the morph I want, how do they price against similar
// geckos, and do they sell hatchlings or grown animals? Filters live in
// the URL like every other page.
import Link from "next/link";
import { getBreeders, getMorphs } from "@/lib/simple/data";
import { pricing, stage, MIN_PRICED } from "@/lib/simple/breeders";
import { Empty, PageIntro } from "@/components/simple/ui";
import { BreederCard } from "@/components/simple/breeder";
import { fmtInt } from "@/lib/format";

export const revalidate = 1800;

export const metadata = {
  title: "Crested gecko breeders - Geck Inspect",
  description:
    "Crested gecko breeders on MorphMarket: what each one focuses on, how their prices compare with similar geckos, and what stage they sell.",
};

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const PAGE_SIZE = 24;

const PRICING_OPTS = [
  { value: "", label: "Any pricing" },
  { value: "below", label: "Prices below similar geckos" },
  { value: "at", label: "Prices in line" },
  { value: "above", label: "Prices above similar geckos" },
];
const STAGE_OPTS = [
  { value: "", label: "Any stage" },
  { value: "hatchlings", label: "Mostly hatchlings" },
  { value: "grown", label: "Mostly grown geckos" },
];
const SORT_OPTS = [
  { value: "", label: "Most listed" },
  { value: "sold", label: "Most sold" },
  { value: "value", label: "Lowest prices vs similar" },
];

export default async function BreedersPage({ searchParams }: { searchParams?: SearchParams }) {
  const q = one(searchParams?.q).slice(0, 60);
  const focusSlug = one(searchParams?.focus);
  const pricingF = one(searchParams?.pricing);
  const stageF = one(searchParams?.stage);
  const sort = one(searchParams?.sort);
  const page = Math.max(1, Number(one(searchParams?.page)) || 1);

  const [all, morphs] = await Promise.all([getBreeders(), getMorphs()]);
  const focusMorph = morphs.find((m) => m.slug === focusSlug) ?? null;

  const needle = q.toLowerCase();
  let list = all.filter((b) => b.forSale > 0 || b.sold > 0);
  if (needle) {
    list = list.filter(
      (b) =>
        b.name.toLowerCase().includes(needle) ||
        (b.location ?? "").toLowerCase().includes(needle),
    );
  }
  if (focusMorph) list = list.filter((b) => b.topTraits.slice(0, 3).includes(focusMorph.trait));
  if (pricingF) list = list.filter((b) => pricing(b) === pricingF);
  if (stageF) list = list.filter((b) => stage(b) === stageF);
  if (sort === "sold") list = [...list].sort((a, b) => b.sold - a.sold || b.forSale - a.forSale);
  if (sort === "value") {
    list = [...list]
      .filter((b) => b.priceRatio != null && b.pricedN >= MIN_PRICED)
      .sort((a, b) => (a.priceRatio ?? 9) - (b.priceRatio ?? 9));
  }

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const shown = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const href = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (focusMorph) s.set("focus", focusMorph.slug);
    if (pricingF) s.set("pricing", pricingF);
    if (stageF) s.set("stage", stageF);
    if (sort) s.set("sort", sort);
    if (p > 1) s.set("page", String(p));
    const str = s.toString();
    return str ? `/sellers?${str}` : "/sellers";
  };
  const filtered = Boolean(q || focusMorph || pricingF || stageF);
  const inputCls =
    "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-claude focus:outline-none";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageIntro title="Breeders">
        Crested gecko breeders on MorphMarket: what each one focuses on, how their prices
        compare with similar geckos, and whether they sell hatchlings or grown animals.
      </PageIntro>

      <form
        method="get"
        action="/sellers"
        className="grid grid-cols-2 gap-3 rounded-xl border border-ink-700 bg-ink-850 p-4 md:grid-cols-[2fr_1.3fr_1.5fr_1.3fr_1.3fr_auto] md:items-end"
      >
        <label className="col-span-2 space-y-1 md:col-span-1">
          <span className="text-sm text-ink-400">Name or place</span>
          <input name="q" defaultValue={q} placeholder="e.g. Florida" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Focus</span>
          <select name="focus" defaultValue={focusMorph?.slug ?? ""} className={inputCls}>
            <option value="">Any morph</option>
            {morphs.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.trait}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Pricing</span>
          <select name="pricing" defaultValue={pricingF} className={inputCls}>
            {PRICING_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Sells</span>
          <select name="stage" defaultValue={stageF} className={inputCls}>
            {STAGE_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Sort</span>
          <select name="sort" defaultValue={sort} className={inputCls}>
            {SORT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="col-span-2 rounded-lg bg-claude px-5 py-2 text-sm font-medium text-ink-950 hover:bg-claude-glow md:col-span-1"
        >
          Show
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-400">
        <span>{fmtInt(list.length)} breeders</span>
        {filtered || sort ? (
          <Link href="/sellers" className="hover:text-ink-100">
            Clear filters
          </Link>
        ) : null}
      </div>

      {shown.length ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((b) => (
            <li key={b.slug}>
              <BreederCard b={b} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No breeders match these filters.</Empty>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={href(page - 1)} className="rounded-lg border border-ink-700 px-4 py-2 text-ink-200 hover:border-ink-500">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-400">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="rounded-lg border border-ink-700 px-4 py-2 text-ink-200 hover:border-ink-500">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <p className="text-sm text-ink-500">
        Pricing compares each listing with similar geckos (same strongest morph, age and
        sex) and takes the breeder&apos;s middle result. It needs at least {MIN_PRICED}{" "}
        priced listings, and says nothing about gecko quality, health or service. Only
        listings that name their store are counted here, which is about 1 in 7 of all
        listings.
      </p>
    </div>
  );
}
