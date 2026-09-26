// One breeder: what they list, at what typical price, their main morphs,
// current listings and past sales. The route param is the MorphMarket
// store slug (the same id older links used).
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBreeders, getListings, getMorphs } from "@/lib/simple/data";
import {
  Avatar,
  Chip,
  Empty,
  ListingGrid,
  Section,
  Stat,
  TextLink,
  fmtShortDate,
} from "@/components/simple/ui";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 1800;

export async function generateMetadata({ params }: { params: { id: string } }) {
  const b = (await getBreeders()).find((x) => x.slug === params.id);
  return {
    title: `${b?.name ?? "Breeder"} - crested gecko breeder - Geck Inspect`,
    description: `Crested geckos listed by ${b?.name ?? "this breeder"} and their typical prices.`,
  };
}

export default async function BreederPage({ params }: { params: { id: string } }) {
  const slug = decodeURIComponent(params.id);
  if (!/^[A-Za-z0-9_.-]+$/.test(slug)) notFound();

  const [breeders, morphs, forSale, sold] = await Promise.all([
    getBreeders(),
    getMorphs(),
    getListings({ seller: slug, status: "for-sale", sort: "newest", limit: 12 }),
    getListings({ seller: slug, status: "sold", sort: "newest", limit: 8 }),
  ]);
  const b = breeders.find((x) => x.slug === slug);
  if (!b && !forSale.rows.length && !sold.rows.length) notFound();

  const name = b?.name ?? forSale.rows[0]?.sellerName ?? slug;
  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="text-sm text-ink-400">
        <Link href="/sellers" className="hover:text-ink-100">
          Breeders
        </Link>{" "}
        / {name}
      </div>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={name} src={b?.avatarUrl ?? null} size={64} />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">{name}</h1>
            <p className="text-ink-400">{b?.location ?? "Location not listed"}</p>
          </div>
        </div>
        <a
          href={`https://www.morphmarket.com/stores/${encodeURIComponent(slug)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-100 hover:border-ink-500 hover:bg-ink-800"
        >
          Open store on MorphMarket
        </a>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Listed"
          value={fmtInt(b?.forSale ?? forSale.total)}
          hint={b?.lastSeenAt ? `Last checked ${fmtShortDate(b.lastSeenAt)}` : undefined}
        />
        <Stat label="Typical asking price" value={b?.askMid != null ? fmtUsd(b.askMid) : "No USD listings"} />
        <Stat label="Sold" value={fmtInt(b?.sold ?? sold.total)} hint="Spring 2026" />
      </div>

      {b?.topTraits.length ? (
        <Section title="Main morphs">
          <div className="flex flex-wrap gap-2">
            {b.topTraits.map((t) => {
              const s = slugOf.get(t);
              return s ? (
                <Chip key={t} href={`/morphs/${s}`}>
                  {t}
                </Chip>
              ) : null;
            })}
          </div>
        </Section>
      ) : null}

      <Section
        title="Listed now"
        note="Tap a listing to open it on MorphMarket."
        action={
          forSale.total > forSale.rows.length ? (
            <TextLink href={`/listings?seller=${encodeURIComponent(slug)}`}>
              See all {fmtInt(forSale.total)}
            </TextLink>
          ) : undefined
        }
      >
        {forSale.rows.length ? <ListingGrid listings={forSale.rows} /> : <Empty>Nothing listed right now.</Empty>}
      </Section>

      {sold.rows.length ? (
        <Section title="Sold" note="The last asking price before the listing came down.">
          <ListingGrid listings={sold.rows} />
        </Section>
      ) : null}
    </div>
  );
}
