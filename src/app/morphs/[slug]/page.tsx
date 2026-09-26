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
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 1800;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const morph = (await getMorphs()).find((m) => m.slug === params.slug);
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

export default async function MorphPage({ params }: { params: { slug: string } }) {
  if (!/^[a-z0-9-]+$/.test(params.slug)) notFound();
  const morphs = await getMorphs();
  const morph = morphs.find((m) => m.slug === params.slug);
  if (!morph) notFound();

  const traits = [morph.trait];
  const [baseline, grid, growth, upgrades, prices, forSale, sold, breeders] = await Promise.all([
    getBaseline(),
    getValueGrid(traits),
    getGrowthCurve(traits),
    getTraitUpgrades(traits),
    getAskingPrices(morph.trait),
    getListings({ traits, status: "for-sale", sort: "newest", limit: 8 }),
    getListings({ traits, status: "sold", sort: "newest", limit: 4 }),
    getBreeders(),
  ]);

  const info = traitInfo(morph.trait);
  const ratio = baseline.p50 && morph.askMid ? morph.askMid / baseline.p50 : null;
  const bins = histogram(prices);
  const maxBin = Math.max(...bins.map((b) => b.count), 1);
  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));
  const topBreeders = breeders.filter((b) => b.topTraits.includes(morph.trait)).slice(0, 6);
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
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-xs text-ink-300">
            {info.kind}
            {info.confidence === "emerging" ? (
              <span className="rounded-full bg-busy/15 px-1.5 text-busy">emerging</span>
            ) : null}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
            {morph.trait}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-300">{info.note}</p>
        </div>
        <ButtonLink href={`/?t=${morph.slug}`}>Price a {morph.trait}</ButtonLink>
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
                    className="rounded-t bg-claude/70"
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
        note="Tap a listing to open it on MorphMarket."
        action={<TextLink href={`/listings?t=${morph.slug}`}>See all {fmtInt(morph.forSale)}</TextLink>}
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
        <Section title={`Breeders who list ${morph.trait} most`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topBreeders.map((b) => (
              <Link
                key={b.slug}
                href={`/sellers/${b.slug}`}
                className="rounded-xl border border-ink-700 bg-ink-850 p-4 transition hover:border-ink-500"
              >
                <div className="font-medium text-ink-50">{b.name}</div>
                <div className="text-sm text-ink-400">
                  {fmtInt(b.forSale)} listed{b.location ? `, ${b.location}` : ""}
                </div>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
