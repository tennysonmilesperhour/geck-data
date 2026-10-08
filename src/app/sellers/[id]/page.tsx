// One breeder: how established they are, what they focus on, how their
// prices sit against similar geckos, what stage they sell, their current
// listings and sales, and breeders with a similar focus.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBreeders, getListings, getMorphs } from "@/lib/simple/data";
import {
  activeSince,
  focus,
  pricingPhrase,
  similarBreeders,
  stagePhrase,
} from "@/lib/simple/breeders";
import {
  Avatar,
  Card,
  Empty,
  ListingGrid,
  Section,
  Stat,
  TextLink,
  fmtShortDate,
} from "@/components/simple/ui";
import { BreederCard, PricingPill, PricingSplit } from "@/components/simple/breeder";
import SaveAlert from "@/components/simple/SaveAlert";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 3600;
export const dynamicParams = true;

// Breeder pages are rendered on first view and then kept at the edge.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await getBreeders()).find((x) => x.slug === id);
  return {
    title: `${b?.name ?? "Breeder"} - crested gecko breeder - Geck Inspect`,
    description: `What ${b?.name ?? "this breeder"} sells, how their prices compare with similar crested geckos, and their current listings.`,
  };
}

export default async function BreederPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = decodeURIComponent(id);
  if (!/^[A-Za-z0-9_.-]+$/.test(slug)) notFound();

  const [breeders, morphs, forSale, sold] = await Promise.all([
    getBreeders(),
    getMorphs(),
    getListings({ seller: slug, status: "for-sale", sort: "value", limit: 12 }),
    getListings({ seller: slug, status: "sold", sort: "newest", limit: 8 }),
  ]);
  const b = breeders.find((x) => x.slug === slug);
  if (!b && !forSale.rows.length && !sold.rows.length) notFound();

  const name = b?.name ?? forSale.rows[0]?.sellerName ?? slug;
  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));
  const since = b ? activeSince(b) : null;
  const phrase = b ? pricingPhrase(b) : null;
  const stageLine = b ? stagePhrase(b) : null;
  const f = b ? focus(b) : [];
  const similar = b ? similarBreeders(b, breeders) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <div className="text-sm text-ink-400">
        <Link href="/sellers" className="hover:text-ink-100">
          Breeders
        </Link>{" "}
        / {name}
      </div>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={name} src={b?.avatarUrl ?? null} size={72} />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">{name}</h1>
            <p className="text-ink-400">
              {[b?.location ?? "Location not listed", since ? `seen on MorphMarket since ${since}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {b ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <PricingPill b={b} />
                {stageLine ? (
                  <span className="rounded-sm bg-ink-800 px-1.5 py-0.5 text-xs text-ink-300">{stageLine}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <a
            href={`https://www.morphmarket.com/stores/${encodeURIComponent(slug)}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-100 hover:border-ink-500 hover:bg-ink-800"
          >
            Open store on MorphMarket
          </a>
          <SaveAlert
            label="Alert me on new listings"
            name={`New listings from ${name}`}
            query={{ seller_ids: [slug] }}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Listed"
          value={fmtInt(b?.forSale ?? forSale.total)}
          hint={b?.lastSeenAt ? `Last checked ${fmtShortDate(b.lastSeenAt)}` : undefined}
        />
        <Stat label="Sold" value={fmtInt(b?.sold ?? sold.total)} hint="Spring 2026" />
        <Stat label="Typical asking price" value={b?.askMid != null ? fmtUsd(b.askMid) : "No USD listings"} />
        <Stat
          label="Female share"
          value={b?.shareFemale != null ? `${Math.round(b.shareFemale * 100)}%` : "no data"}
          hint="Of listings with a stated sex"
        />
      </div>

      {b && b.nLow + b.nTypical + b.nHigh >= 5 ? (
        <Section title="How they price" note={phrase ?? undefined}>
          <Card>
            <PricingSplit b={b} />
          </Card>
        </Section>
      ) : null}

      {f.length ? (
        <Section title="What they focus on" note="Share of their listings carrying each morph.">
          <Card className="space-y-3">
            {f.map((x) => {
              const s = slugOf.get(x.trait);
              return (
                <div key={x.trait} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 text-sm">
                  {s ? (
                    <Link href={`/morphs/${s}`} className="truncate text-ink-100 hover:text-claude-glow">
                      {x.trait}
                    </Link>
                  ) : (
                    <span className="truncate text-ink-100">{x.trait}</span>
                  )}
                  <span className="h-1 overflow-hidden bg-ink-800">
                    <span className="bar-fill block h-full" style={{ width: `${Math.max(x.share * 100, 3)}%` }} />
                  </span>
                  <span className="w-20 text-right tabular-nums text-ink-400">
                    {Math.round(x.share * 100)}% ({fmtInt(x.count)})
                  </span>
                </div>
              );
            })}
          </Card>
        </Section>
      ) : null}

      <Section
        title="Listed now"
        note="Best value first: priced lowest against similar geckos. Tap one to see how its price compares."
        action={
          forSale.total > forSale.rows.length ? (
            <TextLink href={`/listings?seller=${encodeURIComponent(slug)}&sort=value`}>
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

      {similar.length ? (
        <Section title="Breeders with a similar focus">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {similar.map((o) => (
              <BreederCard key={o.slug} b={o} />
            ))}
          </div>
        </Section>
      ) : null}

      <p className="text-sm text-ink-500">
        Pricing and focus come from this breeder&apos;s MorphMarket listings only. They say
        nothing about gecko quality, health, shipping or service; check the store&apos;s
        reviews on MorphMarket for that.
      </p>
    </div>
  );
}
