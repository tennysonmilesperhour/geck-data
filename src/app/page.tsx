// Home: the price check. Pick the morphs a gecko has and see what geckos
// like it sold for and what they are listed at right now. Everything
// lives in the URL (?t=lilly-white,cappuccino) so a result can be shared
// and the back button works.
import Link from "next/link";
import {
  getAskingBand,
  getListings,
  getMorphs,
  getSoldBand,
  traitsFromSlugs,
  type Morph,
  type PriceBand,
} from "@/lib/simple/data";
import {
  ButtonLink,
  Card,
  Chip,
  Empty,
  ListingGrid,
  PriceRangeBar,
  PriceScale,
  Section,
  TextLink,
  fmtMonthRange,
  fmtShortDate,
  niceMax,
} from "@/components/simple/ui";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 900;

type SearchParams = Record<string, string | string[] | undefined>;

function parseSlugs(sp?: SearchParams): string[] {
  const raw = sp?.t;
  const s = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  return s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[a-z0-9-]+$/.test(x))
    .slice(0, 6);
}

function hrefFor(slugs: string[]): string {
  return slugs.length ? `/?t=${slugs.join(",")}` : "/";
}

function toggle(slugs: string[], slug: string): string[] {
  return slugs.includes(slug) ? slugs.filter((s) => s !== slug) : [...slugs, slug];
}

export default async function PriceCheckPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const morphs = await getMorphs();
  const selected = traitsFromSlugs(morphs, parseSlugs(searchParams));
  const selectedSlugs = selected.map((m) => m.slug);
  const traitNames = selected.map((m) => m.trait);

  const [sold, asking, forSale, recentSold] = selected.length
    ? await Promise.all([
        getSoldBand(traitNames),
        getAskingBand(traitNames),
        getListings({ traits: traitNames, status: "for-sale", sort: "newest", limit: 8 }),
        getListings({ traits: traitNames, status: "sold", sort: "newest", limit: 4 }),
      ])
    : [null, null, null, null];

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
          What is your crested gecko worth?
        </h1>
        <p className="mt-4 text-lg leading-8 text-ink-300">
          Pick the morphs your gecko has. We compare it against thousands of real
          MorphMarket listings and show what similar geckos sold for and what they
          are listed at.
        </p>
      </header>

      <MorphPicker morphs={morphs} selectedSlugs={selectedSlugs} />

      {selected.length ? (
        <>
          <Result
            names={traitNames}
            sold={sold}
            asking={asking}
          />
          {forSale && forSale.rows.length ? (
            <Section
              title="Listed now"
              note={`${fmtInt(forSale.total)} listings with ${traitNames.join(" + ")}. Tap one to open it on MorphMarket.`}
              action={
                <TextLink href={`/listings?t=${selectedSlugs.join(",")}`}>
                  See all listings
                </TextLink>
              }
            >
              <ListingGrid listings={forSale.rows} />
            </Section>
          ) : null}
          {recentSold && recentSold.rows.length ? (
            <Section
              title="Recently sold"
              note="The last asking price before the listing came down."
              action={
                <TextLink href={`/listings?status=sold&t=${selectedSlugs.join(",")}`}>
                  See all sold
                </TextLink>
              }
            >
              <ListingGrid listings={recentSold.rows} />
            </Section>
          ) : null}
        </>
      ) : (
        <PopularMorphs morphs={morphs.slice(0, 8)} />
      )}
    </div>
  );
}

function MorphPicker({
  morphs,
  selectedSlugs,
}: {
  morphs: Morph[];
  selectedSlugs: string[];
}) {
  if (!morphs.length) {
    return <Empty>Morph list could not load right now. Try again in a minute.</Empty>;
  }
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-50">
          {selectedSlugs.length ? "Your gecko" : "Choose one or more morphs"}
        </h2>
        {selectedSlugs.length ? (
          <Link href="/" scroll={false} className="text-sm text-ink-400 hover:text-ink-100">
            Clear
          </Link>
        ) : null}
      </div>
      {selectedSlugs.length ? (
        <>
          <div className="flex flex-wrap gap-2">
            {morphs
              .filter((m) => selectedSlugs.includes(m.slug))
              .map((m) => (
                <Chip
                  key={m.slug}
                  href={hrefFor(toggle(selectedSlugs, m.slug))}
                  active
                  title={`Remove ${m.trait}`}
                >
                  {m.trait} <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove</span>
                </Chip>
              ))}
          </div>
          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-medium text-claude-glow hover:underline">
              <span className="group-open:hidden">+ Add another morph</span>
              <span className="hidden group-open:inline">Hide morph list</span>
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {morphs
                .filter((m) => !selectedSlugs.includes(m.slug))
                .map((m) => (
                  <Chip
                    key={m.slug}
                    href={hrefFor(toggle(selectedSlugs, m.slug))}
                    title={`${fmtInt(m.forSale)} listed`}
                  >
                    {m.trait}
                  </Chip>
                ))}
            </div>
          </details>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {morphs.map((m) => (
            <Chip
              key={m.slug}
              href={hrefFor(toggle(selectedSlugs, m.slug))}
              title={`${fmtInt(m.forSale)} listed`}
            >
              {m.trait}
            </Chip>
          ))}
        </div>
      )}
      <p className="text-xs text-ink-500">
        Sorted by how often each morph is listed. Pick fewer morphs for more matches.
      </p>
    </Card>
  );
}

function confidenceLine(n: number, sellers: number): string {
  if (n >= 30) return `Solid: ${fmtInt(n)} sales from ${fmtInt(sellers)} breeders.`;
  if (n >= 10) return `Fair: ${fmtInt(n)} sales from ${fmtInt(sellers)} breeders. Use it as a guide.`;
  return `Thin: only ${fmtInt(n)} matching sales. Treat this as a rough guide.`;
}

function Result({
  names,
  sold,
  asking,
}: {
  names: string[];
  sold: PriceBand | null;
  asking: PriceBand | null;
}) {
  const headline = sold && sold.n >= 3 ? sold : asking;
  if (!headline) {
    return (
      <Empty>
        No listings or sales match {names.join(" + ")} yet. Try removing a morph.
      </Empty>
    );
  }
  const scaleMax = niceMax(
    Math.max(sold?.p90 ?? 0, asking?.p90 ?? 0, headline.p75 ?? 0, 100),
  );
  const fromSold = headline === sold;

  return (
    <Card className="space-y-6 p-6">
      <div>
        <div className="text-sm text-ink-400">
          {names.join(" + ")}, {fromSold ? "typical sale price" : "typical asking price"}
        </div>
        <div className="mt-1 text-4xl font-semibold tabular-nums text-ink-50 sm:text-5xl">
          {fmtUsd(headline.p25)} to {fmtUsd(headline.p75)}
        </div>
        <div className="mt-2 text-base text-ink-300">
          Middle price {fmtUsd(headline.p50)}. Half of {fromSold ? "sales" : "listings"} fall in
          this range.
        </div>
        <div className="mt-1 text-sm text-ink-400">
          {fromSold
            ? confidenceLine(sold!.n, sold!.sellers)
            : "Not enough sales yet, so this uses current asking prices instead."}
        </div>
      </div>

      <div className="space-y-5">
        <BandRow
          title="Sold for"
          detail={
            sold
              ? `${fmtInt(sold.n)} sales, ${fmtMonthRange(sold.oldest, sold.newest)}`
              : "No matching sales"
          }
          band={sold}
          scaleMax={scaleMax}
        />
        <BandRow
          title="Listed at"
          detail={
            asking
              ? `${fmtInt(asking.n)} listings, last checked ${fmtShortDate(asking.newest)}`
              : "Nothing listed right now"
          }
          band={asking}
          scaleMax={scaleMax}
        />
        <PriceScale max={scaleMax} />
      </div>

      <p className="text-xs leading-5 text-ink-500">
        Dot is the middle price. The bar covers the middle half. The thin line runs
        from the cheapest tenth to the priciest tenth. Sold prices are the last
        asking price before a listing came down, not a confirmed payment. Pattern
        quality, lineage and size move real prices a lot.{" "}
        <Link href="/methodology" className="text-ink-300 underline hover:text-ink-100">
          How this works
        </Link>
      </p>
    </Card>
  );
}

function BandRow({
  title,
  detail,
  band,
  scaleMax,
}: {
  title: string;
  detail: string;
  band: PriceBand | null;
  scaleMax: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-5">
      <div>
        <div className="font-medium text-ink-100">
          {title}{" "}
          {band ? (
            <span className="tabular-nums text-ink-300">
              {fmtUsd(band.p25)} to {fmtUsd(band.p75)}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-ink-500">{detail}</div>
      </div>
      {band ? <PriceRangeBar band={band} scaleMax={scaleMax} /> : <div className="text-sm text-ink-500">No data</div>}
    </div>
  );
}

function PopularMorphs({ morphs }: { morphs: Morph[] }) {
  if (!morphs.length) return null;
  return (
    <Section
      title="Popular morphs"
      note="Typical asking price across current listings."
      action={<TextLink href="/morphs">All morphs</TextLink>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {morphs.map((m) => (
          <Link
            key={m.slug}
            href={`/morphs/${m.slug}`}
            className="rounded-xl border border-ink-700 bg-ink-850 p-4 transition hover:border-ink-500"
          >
            <div className="font-medium text-ink-50">{m.trait}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-ink-50">
              {fmtUsd(m.askMid)}
            </div>
            <div className="text-xs text-ink-400">
              typical ask, {fmtInt(m.forSale)} listed
            </div>
          </Link>
        ))}
      </div>
      <div className="pt-2">
        <ButtonLink href="/listings" variant="quiet">
          Browse listings
        </ButtonLink>
      </div>
    </Section>
  );
}
