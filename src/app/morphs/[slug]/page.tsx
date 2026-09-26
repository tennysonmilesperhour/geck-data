// One morph: what it lists and sells for, how asking prices spread out,
// which morphs it is usually paired with, current listings, recent sales
// and the breeders who list it most.
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAskingPrices,
  getBreeders,
  getListings,
  getMorphs,
  getPairings,
} from "@/lib/simple/data";
import {
  ButtonLink,
  Chip,
  Empty,
  ListingGrid,
  PageIntro,
  Section,
  Stat,
  TextLink,
  fmtShortDate,
} from "@/components/simple/ui";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 1800;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const morph = (await getMorphs()).find((m) => m.slug === params.slug);
  const name = morph?.trait ?? "Morph";
  return {
    title: `${name} crested gecko prices - Geck Inspect`,
    description: `What ${name} crested geckos list and sell for, with current listings and common pairings.`,
  };
}

const BUCKETS = [0, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000];

function histogram(prices: number[]) {
  return BUCKETS.map((lo, i) => {
    const hi = BUCKETS[i + 1] ?? Infinity;
    return {
      label: hi === Infinity ? `${fmtUsd(lo)}+` : `${fmtUsd(lo)} to ${fmtUsd(hi)}`,
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

  const realTraits = new Set(morphs.map((m) => m.trait));
  const [prices, pairings, forSale, sold, breeders] = await Promise.all([
    getAskingPrices(morph.trait),
    getPairings(morph.trait, realTraits),
    getListings({ traits: [morph.trait], status: "for-sale", sort: "newest", limit: 8 }),
    getListings({ traits: [morph.trait], status: "sold", sort: "newest", limit: 4 }),
    getBreeders(),
  ]);

  const bins = histogram(prices);
  const maxBin = Math.max(...bins.map((b) => b.count), 1);
  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));
  const topBreeders = breeders.filter((b) => b.topTraits.includes(morph.trait)).slice(0, 6);

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="text-sm text-ink-400">
        <Link href="/morphs" className="hover:text-ink-100">
          Morphs
        </Link>{" "}
        / {morph.trait}
      </div>

      <PageIntro
        title={morph.trait}
        action={
          <ButtonLink href={`/?t=${morph.slug}`}>Price check a {morph.trait}</ButtonLink>
        }
      >
        Crested geckos listed with the {morph.trait} trait on MorphMarket.
      </PageIntro>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Listed"
          value={fmtInt(morph.forSale)}
          hint={`Last checked ${fmtShortDate(morph.lastSeenAt)}`}
        />
        <Stat
          label="Typical asking price"
          value={fmtUsd(morph.askMid)}
          hint={
            morph.askLow != null
              ? `Most list between ${fmtUsd(morph.askLow)} and ${fmtUsd(morph.askHigh)}`
              : undefined
          }
        />
        <Stat
          label="Typical sold price"
          value={morph.sold >= 3 ? fmtUsd(morph.soldMid) : "Too few sales"}
          hint={`${fmtInt(morph.sold)} sales, spring 2026`}
        />
      </div>

      {prices.length ? (
        <Section title="How asking prices spread out" note={`${fmtInt(prices.length)} current listings in USD.`}>
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-5">
            <div className="flex h-40 items-end gap-1.5 sm:gap-2">
              {bins.map((b) => (
                <div key={b.label} className="flex h-full flex-1 flex-col justify-end" title={`${b.label}: ${b.count}`}>
                  <div className="mb-1 text-center text-[11px] tabular-nums text-ink-400">
                    {b.count || ""}
                  </div>
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
          </div>
        </Section>
      ) : null}

      {pairings.length ? (
        <Section
          title="Often paired with"
          note={`Tap a pairing to price check ${morph.trait} with it.`}
        >
          <div className="flex flex-wrap gap-2">
            {pairings.slice(0, 12).map((p) => {
              const other = slugOf.get(p.trait);
              return other ? (
                <Chip key={p.trait} href={`/?t=${morph.slug},${other}`}>
                  {p.trait} <span className="text-ink-500">{fmtInt(p.count)}</span>
                </Chip>
              ) : null;
            })}
          </div>
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
