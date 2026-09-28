// One listing, with its price in context: how it compares with similar
// geckos (same strongest morph, age and sex), where it falls among them,
// the seller, and similar geckos listed now. A clear button goes to the
// original MorphMarket listing.
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getBreeders,
  getComparablePrices,
  getListing,
  getListingPriceHistory,
  getListings,
  getMorphs,
} from "@/lib/simple/data";
import {
  Card,
  Chip,
  ListingGrid,
  Section,
  Stat,
  TextLink,
  fmtShortDate,
} from "@/components/simple/ui";
import ListingImage from "@/components/media/ListingImage";
import { BreederCard } from "@/components/simple/breeder";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 1800;

const AGE: Record<string, string> = {
  hatchling: "hatchling",
  juvenile: "juvenile",
  subadult: "subadult",
  adult: "adult",
};

export async function generateMetadata({ params }: { params: { id: string } }) {
  const l = await getListing(params.id);
  return {
    title: l ? `${l.traits.join(" ") || l.name || "Crested gecko"} ${fmtUsd(l.price)} - Geck Inspect` : "Listing - Geck Inspect",
    description: "How this crested gecko's asking price compares with similar geckos.",
  };
}

export default async function ListingPage({ params }: { params: { id: string } }) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(params.id)) notFound();
  const l = await getListing(params.id);
  if (!l) notFound();

  const [morphs, comps, similar, breeders, history] = await Promise.all([
    getMorphs(),
    getComparablePrices({ trait: l.comparedTrait, ageClass: l.ageClass, sexClass: l.sexClass, basis: l.basis }),
    getListings({
      traits: l.comparedTrait ? [l.comparedTrait] : [],
      status: "for-sale",
      sex: l.sexClass === "male" || l.sexClass === "female" ? l.sexClass : null,
      age: l.ageClass,
      sort: "value",
      limit: 9,
    }),
    l.sellerSlug ? getBreeders() : Promise.resolve([]),
    getListingPriceHistory(l.id),
  ]);
  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));
  const breeder = breeders.find((b) => b.slug === l.sellerSlug) ?? null;
  const sold = Boolean(l.soldAt);

  const cheaperThan =
    l.price != null && comps.length >= 5
      ? Math.round((comps.filter((p) => p > (l.price as number)).length / comps.length) * 100)
      : null;
  const groupName = [
    l.basis === "trait_age_sex" || l.basis === "market_age_sex"
      ? l.sexClass === "unsexed" ? "unsexed" : l.sexClass
      : null,
    l.basis !== "trait" && l.basis !== "market" && l.ageClass ? AGE[l.ageClass] : null,
    l.comparedTrait ?? "crested geckos",
  ]
    .filter(Boolean)
    .join(" ");
  const maturity = l.maturity === "Baby" ? "Hatchling" : l.maturity;
  const priceCheckHref = (() => {
    const p = new URLSearchParams();
    const slugs = l.traits.map((t) => slugOf.get(t)).filter(Boolean) as string[];
    if (slugs.length) p.set("t", slugs.slice(0, 4).join(","));
    if (l.sexClass) p.set("sex", l.sexClass);
    if (l.ageClass) p.set("age", l.ageClass);
    const s = p.toString().replace(/%2C/g, ",");
    return s ? `/?${s}` : "/";
  })();

  // Strip plot of comparable prices with this listing marked.
  const sorted = [...comps].sort((a, b) => a - b);
  const cap = sorted.length ? sorted[Math.floor(sorted.length * 0.97)] ?? sorted[sorted.length - 1] : 0;
  const axisMax = Math.max(cap, l.price ?? 0) * 1.05 || 1;

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <div className="text-sm text-ink-400">
        <Link href="/listings" className="hover:text-ink-100">
          Listings
        </Link>{" "}
        / {l.traits.slice(0, 3).join(", ") || l.name || "Crested gecko"}
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ListingImage
          src={l.image}
          alt={l.name ?? "Crested gecko"}
          className="aspect-square w-full rounded-xl"
          sizes="(max-width: 768px) 100vw, 480px"
          priority
        />
        <div className="space-y-5">
          <div>
            <div className="text-sm text-ink-400">
              {sold ? `Came down ${fmtShortDate(l.soldAt)}` : `Listed, last checked ${fmtShortDate(l.lastSeenAt)}`}
            </div>
            <h1 className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-ink-50">
              {fmtUsd(l.price)}
              {l.currency && l.currency !== "USD" ? ` ${l.currency}` : ""}
            </h1>
            <p className="mt-1 text-ink-300">
              {[l.sexClass === "male" ? "Male" : l.sexClass === "female" ? "Female" : "Not sexed", maturity, l.weight ? `${Math.round(l.weight)}g` : null]
                .filter(Boolean)
                .join(", ")}
            </p>
            {l.name ? <p className="mt-1 text-sm text-ink-500">&quot;{l.name}&quot;</p> : null}
          </div>

          {l.traits.length ? (
            <div className="flex flex-wrap gap-2">
              {l.traits.map((t) => {
                const s = slugOf.get(t);
                return s ? (
                  <Chip key={t} href={`/morphs/${s}`}>
                    {t}
                  </Chip>
                ) : (
                  <span key={t} className="rounded-sm border border-ink-700 px-2 py-1 text-[13px] text-ink-400">
                    {t}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {l.url ? (
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg bg-claude px-4 py-2 text-sm font-medium text-white hover:bg-claude-soft"
              >
                Open on MorphMarket
              </a>
            ) : null}
            <Link
              href={priceCheckHref}
              className="inline-flex items-center rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-100 hover:border-ink-500 hover:bg-ink-800"
            >
              Price check this gecko
            </Link>
          </div>
        </div>
      </div>

      {l.position && l.similarMid != null ? (
        <Section
          title="How this price compares"
          note={`Against ${fmtInt(l.comparedN)} listings of ${groupName}.`}
        >
          <Card className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="This gecko" value={fmtUsd(l.price)} />
              <Stat label="Similar geckos, middle" value={fmtUsd(l.similarMid)} />
              <Stat label="Similar geckos, most" value={`${fmtUsd(l.similarLow)} to ${fmtUsd(l.similarHigh)}`} />
              <Stat
                label="Priced below"
                value={cheaperThan != null ? `${cheaperThan}%` : "no data"}
                hint="of similar listings"
              />
            </div>
            {sorted.length >= 5 && l.price != null ? (
              <div>
                <div className="relative h-10" role="img" aria-label={`This listing at ${fmtUsd(l.price)} among ${sorted.length} similar listings`}>
                  {sorted.map((p, i) => (
                    <span
                      key={i}
                      className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-ink-500/50"
                      style={{ left: `${Math.min((p / axisMax) * 100, 100)}%` }}
                    />
                  ))}
                  <span
                    className="absolute top-1/2 h-7 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-claude-glow"
                    style={{ left: `${Math.min((l.price / axisMax) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs tabular-nums text-ink-500">
                  <span>$0</span>
                  <span>{fmtUsd(axisMax)}</span>
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Each thin line is one similar listing. The bright bar is this gecko.
                </p>
              </div>
            ) : null}
            <p className="text-sm text-ink-400">
              Similar means the same strongest morph
              {l.basis === "trait_age_sex" || l.basis === "market_age_sex" ? ", age and sex" : l.basis === "trait_age" ? " and age" : ""}.
              Listings don&apos;t measure pattern quality, color or lineage, which move real
              prices a lot, so a low price can also mean a plainer gecko.
            </p>
          </Card>
        </Section>
      ) : null}

      {history.length ? (
        <Section
          title="Price history"
          note={
            history.length > 1
              ? `The asking price changed ${history.length - 1} ${history.length === 2 ? "time" : "times"} while we tracked it.`
              : "The asking price has not changed while we tracked it."
          }
        >
          <Card>
            <ol className="space-y-2">
              {history.map((p, i) => {
                const prev = history[i - 1];
                const diff = prev && prev.currency === p.currency ? p.price - prev.price : null;
                return (
                  <li key={p.at} className="flex flex-wrap items-baseline gap-x-3 text-ink-200">
                    <span className="w-28 text-sm text-ink-400">{fmtShortDate(p.at)}</span>
                    <span className="font-medium tabular-nums">
                      {fmtUsd(p.price)}
                      {p.currency && p.currency !== "USD" ? ` ${p.currency}` : ""}
                    </span>
                    <span className="text-sm text-ink-400">
                      {i === 0
                        ? "first price seen"
                        : diff == null || diff === 0
                          ? "price changed"
                          : diff < 0
                            ? `cut ${fmtUsd(-diff)}`
                            : `raised ${fmtUsd(diff)}`}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-sm text-ink-500">
              Last checked {fmtShortDate(l.lastSeenAt)}. A cut followed by a raise a week later is usually a
              temporary sale price.
            </p>
          </Card>
        </Section>
      ) : null}

      {breeder ? (
        <Section title="Seller">
          <div className="max-w-md">
            <BreederCard b={breeder} />
          </div>
        </Section>
      ) : l.sellerName ? (
        <Section title="Seller">
          <p className="text-ink-300">{l.sellerName}</p>
        </Section>
      ) : null}

      {similar.rows.filter((r) => r.id !== l.id).length ? (
        <Section
          title="Similar geckos listed now"
          note="Best value first."
          action={
            l.comparedTrait && slugOf.get(l.comparedTrait) ? (
              <TextLink href={`/listings?t=${slugOf.get(l.comparedTrait)}&sort=value`}>See more</TextLink>
            ) : undefined
          }
        >
          <ListingGrid listings={similar.rows.filter((r) => r.id !== l.id).slice(0, 8)} />
        </Section>
      ) : null}
    </div>
  );
}
