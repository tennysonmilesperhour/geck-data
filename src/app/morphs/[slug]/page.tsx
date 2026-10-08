// One morph: what it is genetically, what it is worth at each age and sex,
// how its value grows, which pairings are worth the most, and real
// listings, sales and breeders.
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAskingPrices,
  getBaseline,
  getBreeders,
  getGrowthCurve,
  getListings,
  getMarketTrend,
  getMorphs,
  getTraitUpgrades,
  getValueGrid,
} from "@/lib/simple/data";
import { traitInfo } from "@/lib/simple/genetics";
import {
  ButtonLink,
  Card,
  Empty,
  ListingGrid,
  Section,
  Stat,
  TextLink,
  fmtShortDate,
} from "@/components/simple/ui";
import { UpgradeList, ValueGridTable } from "@/components/simple/value";
import GrowthChart from "@/components/simple/GrowthChart";
import { PriceTrendChart } from "@/components/simple/TrendCharts";
import { BreederCard } from "@/components/simple/breeder";
import SaveAlert from "@/components/simple/SaveAlert";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 3600;
export const dynamicParams = true;

// Prebuild every known morph so the first visit is the edge cache, not a
// cross-country render. A morph that appears later is rendered once, then cached.
export async function generateStaticParams() {
  const morphs = await getMorphs();
  return morphs.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const morph = (await getMorphs()).find((m) => m.slug === slug);
  const name = morph?.trait ?? "Morph";
  return {
    title: `${name} crested gecko prices - Geck Inspect`,
    description: `What ${name} crested geckos are worth by age and sex, how their value grows, and which pairings add the most.`,
  };
}

const BUCKETS = [0, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000];

function histogram(prices: number[]) {
  return BUCKETS.map((lo, i) => {
    const hi = BUCKETS[i + 1] ?? Infinity;
    return {
      label: hi === Infinity ? `${fmtUsd(lo)} and up` : `${fmtUsd(lo)} to ${fmtUsd(hi)}`,
      short: hi === Infinity ? `${fmtUsd(lo)}+` : fmtUsd(lo),
      count: prices.filter((p) => p >= lo && p < hi).length,
    };
  });
}

export default async function MorphPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  const morphs = await getMorphs();
  const morph = morphs.find((m) => m.slug === slug);
  if (!morph) notFound();

  const traits = [morph.trait];
  const [baseline, grid, growth, upgrades, prices, forSale, sold, breeders, trend] = await Promise.all([
    getBaseline(),
    getValueGrid(traits),
    getGrowthCurve(traits),
    getTraitUpgrades(traits),
    getAskingPrices(morph.trait),
    getListings({ traits, status: "for-sale", sort: "value", limit: 8 }),
    getListings({ traits, status: "sold", sort: "newest", limit: 4 }),
    getBreeders(),
    getMarketTrend(morph.trait),
  ]);

  const info = traitInfo(morph.trait);
  const ratio = baseline.p50 && morph.askMid ? morph.askMid / baseline.p50 : null;
  const bins = histogram(prices);
  const maxBin = Math.max(...bins.map((b) => b.count), 1);
  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));
  // Breeders whose top three morphs include this one, most listed first.
  const topBreeders = breeders
    .filter((b) => b.forSale > 0 && b.topTraits.slice(0, 3).includes(morph.trait))
    .slice(0, 6);
  const growthEnough = growth.filter((p) => p.sex !== "all" && p.n >= 6).length >= 3;

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <div className="text-sm text-ink-400">
        <Link href="/morphs" className="hover:text-ink-100">
          Morphs
        </Link>{" "}
        / {morph.trait}
      </div>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-2 rounded-sm border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-300">
            {info.kind}
            {info.confidence === "emerging" ? (
              <span className="rounded-sm bg-busy/15 px-1.5 text-busy">emerging</span>
            ) : null}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            {morph.trait}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-300">{info.note}</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <ButtonLink href={`/?t=${morph.slug}`}>Price a {morph.trait}</ButtonLink>
          {morph.askLow != null ? (
            <SaveAlert
              label={`Alert me under ${fmtUsd(morph.askLow)}`}
              name={`${morph.trait} under ${fmtUsd(morph.askLow)}`}
              query={{ trait_all: [morph.trait], max_price: morph.askLow }}
            />
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Typical asking price"
          value={fmtUsd(morph.askMid)}
          hint={
            morph.askLow != null ? `Most ${fmtUsd(morph.askLow)} to ${fmtUsd(morph.askHigh)}` : undefined
          }
        />
        <Stat
          label="Versus a typical crested"
          value={ratio ? `${ratio.toFixed(1)}×` : "no data"}
          hint={baseline.p50 ? `Typical crested ${fmtUsd(baseline.p50)}` : undefined}
        />
        <Stat
          label="Listed"
          value={fmtInt(morph.forSale)}
          hint={`Last checked ${fmtShortDate(morph.lastSeenAt)}`}
        />
        <Stat
          label="Typical sold price"
          value={morph.sold >= 3 ? fmtUsd(morph.soldMid) : "Too few"}
          hint={`${fmtInt(morph.sold)} sales, spring 2026`}
        />
      </div>

      <Section
        title="Value by age and sex"
        note={`Typical asking price for ${morph.trait} at each stage. Tap a box to price that gecko.`}
      >
        <ValueGridTable
          grid={grid}
          age={null}
          sex={null}
          hrefFor={(a, s) => `/?t=${morph.slug}&sex=${s}&age=${a}`}
        />
      </Section>

      {growthEnough ? (
        <Section title="How value grows" note="Middle asking price by weight.">
          <Card>
            <GrowthChart points={growth} />
          </Card>
        </Section>
      ) : null}

      {trend.filter((w) => w.p50 != null).length >= 2 ? (
        <Section
          title="Price over time"
          note="Middle asking price each tracked week."
          action={<TextLink href={`/trends?t=${morph.slug}`}>Full history</TextLink>}
        >
          <Card>
            <PriceTrendChart weeks={trend} label={morph.trait} />
          </Card>
        </Section>
      ) : null}

      {upgrades.length ? (
        <Section
          title="Pairings worth the most"
          note={`Typical asking price when a ${morph.trait} also has the trait. Tap one to price that combination.`}
        >
          <UpgradeList
            upgrades={upgrades}
            hrefFor={(t) => {
              const s = slugOf.get(t);
              return s ? `/?t=${morph.slug},${s}` : null;
            }}
          />
        </Section>
      ) : null}

      {prices.length ? (
        <Section title="How asking prices spread out" note={`${fmtInt(prices.length)} current listings in USD.`}>
          <Card>
            <div className="flex h-40 items-end gap-1.5 sm:gap-2" role="img" aria-label={bins.map((b) => `${b.label}: ${b.count}`).join(", ")}>
              {bins.map((b) => (
                <div key={b.label} className="flex h-full flex-1 flex-col justify-end" title={`${b.label}: ${b.count}`}>
                  <div className="mb-1 text-center text-[11px] tabular-nums text-ink-400">{b.count || ""}</div>
                  <div
                    className="bar-fill-v"
                    style={{ height: `${(b.count / maxBin) * 100}%`, minHeight: b.count ? 2 : 0 }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5 border-t border-ink-700 pt-2 sm:gap-2">
              {bins.map((b) => (
                <div key={b.label} className="flex-1 text-center text-[10px] tabular-nums text-ink-500 sm:text-xs">
                  {b.short}
                </div>
              ))}
            </div>
          </Card>
        </Section>
      ) : null}

      <Section
        title="Listed now"
        note="Best value first: priced lowest against similar geckos."
        action={<TextLink href={`/listings?t=${morph.slug}&sort=value`}>See all {fmtInt(morph.forSale)}</TextLink>}
      >
        {forSale.rows.length ? <ListingGrid listings={forSale.rows} /> : <Empty>Nothing listed right now.</Empty>}
      </Section>

      {sold.rows.length ? (
        <Section
          title="Recently sold"
          note="The last asking price before the listing came down."
          action={<TextLink href={`/listings?status=sold&t=${morph.slug}`}>See all sold</TextLink>}
        >
          <ListingGrid listings={sold.rows} />
        </Section>
      ) : null}

      {topBreeders.length ? (
        <Section
          title={`Breeders who focus on ${morph.trait}`}
          action={<TextLink href={`/sellers?focus=${morph.slug}`}>See all</TextLink>}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {topBreeders.map((b) => (
              <BreederCard key={b.slug} b={b} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
