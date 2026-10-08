// Crested gecko markets side by side: the US, South Korea, Japan, Europe, Canada
// and the UK, all in US dollars. Leads with where prices differ enough to
// matter (buy in one market, sell in another), then every morph in every
// market, then how each market's prices move over time.
import Link from "next/link";
import {
  getFxRates,
  getImportMarkup,
  getMarketCompare,
  getMarketWeekly,
  getMorphs,
  type MarketCell,
  type MarketCode,
} from "@/lib/simple/data";
import { MARKETS, MIN_N, comparableTraits, opportunities, pivot, vsUs, type Opportunity } from "@/lib/simple/markets";
import { Card, Chip, PageIntro, Section, Stat, fmtShortDate } from "@/components/simple/ui";
import MultiLineChart, { type LineSeries } from "@/components/simple/MultiLineChart";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 3600;

export const metadata = {
  title: "Markets - Geck Inspect Market",
  description:
    "Crested gecko asking prices in the US, South Korea, Japan, Europe and Canada, side by side in US dollars, with the morphs where the gap is big enough to trade.",
};

const NAME: Record<string, string> = Object.fromEntries(MARKETS.map((m) => [m.code, m.name]));

function OppTable({
  rows,
  direction,
  slugOf,
}: {
  rows: Opportunity[];
  direction: "import" | "export";
  slugOf: (t: string) => string | null;
}) {
  if (!rows.length) return <p className="text-sm text-ink-400">No morph clears the bar right now.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-700">
      <table className="plain w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-ink-850 text-ink-400">
          <tr>
            <th className="px-3 py-2 font-medium">Morph</th>
            <th className="px-3 py-2 text-right font-medium">Buy at</th>
            <th className="px-3 py-2 text-right font-medium">Sell at</th>
            <th className="px-3 py-2 text-right font-medium">Room per gecko</th>
            <th className="px-3 py-2 text-right font-medium">Listings</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-ink-200">
          {rows.slice(0, 8).map((o) => {
            const slug = slugOf(o.trait);
            return (
              <tr key={o.trait} className="border-t border-ink-800">
                <td className="px-3 py-2">
                  {slug ? (
                    <Link href={`/markets?t=${slug}#over-time`} className="hover:text-ink-50 hover:underline">
                      {o.trait}
                    </Link>
                  ) : (
                    o.trait
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {fmtUsd(o.buy)} <span className="text-xs text-ink-500">{direction === "import" ? NAME[o.market] : "US"}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  {fmtUsd(o.sell)} <span className="text-xs text-ink-500">{direction === "import" ? "US" : NAME[o.market]}</span>
                </td>
                <td className="px-3 py-2 text-right font-medium text-claude-glow">{fmtUsd(o.room)}</td>
                <td className="px-3 py-2 text-right text-ink-400">
                  {fmtInt(o.buyN)} / {fmtInt(o.sellN)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PriceCell({ cell, us }: { cell: MarketCell | undefined; us: MarketCell | undefined }) {
  if (!cell || cell.p50 == null || cell.n < MIN_N) return <span className="text-ink-600">few</span>;
  const cmp = us && us.p50 != null && cell.market !== "US" ? vsUs(cell.p50, us.p50) : null;
  return (
    <span>
      <span className="text-ink-100">{fmtUsd(cell.p50)}</span>
      {cmp ? (
        <span className={`ml-1.5 text-xs ${cmp.dir === "below" ? "text-ready" : cmp.dir === "above" ? "text-busy" : "text-ink-500"}`}>
          {cmp.text}
        </span>
      ) : null}
      <span className="block text-xs text-ink-500">{fmtInt(cell.n)} listed</span>
    </span>
  );
}

export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const params = await searchParams;
  const [cells, morphs, fx, markup] = await Promise.all([
    getMarketCompare(5),
    getMorphs(),
    getFxRates(),
    getImportMarkup(),
  ]);
  const grid = pivot(cells);
  const bySlug = new Map(morphs.map((m) => [m.slug, m.trait]));
  const slugByLower = new Map(morphs.map((m) => [m.trait.toLowerCase(), m.slug]));
  const slugOf = (t: string) => slugByLower.get(t.toLowerCase()) ?? null;
  const picked = params.t ? bySlug.get(params.t) ?? null : null;
  const weekly = await getMarketWeekly(picked);

  const overall = grid.get(null) ?? new Map<MarketCode, MarketCell>();
  const rate = new Map(fx.map((r) => [r.currency, r]));
  const traits = comparableTraits(grid);
  const importMarkup = markup && markup > 1 && markup < 1.5 ? markup : 1;

  const krImport = opportunities(grid, "KR", "import", importMarkup);
  const krExport = opportunities(grid, "KR", "export");
  const euImport = opportunities(grid, "EU", "import");
  const euExport = opportunities(grid, "EU", "export");
  const jpImport = opportunities(grid, "JP", "import");
  const jpExport = opportunities(grid, "JP", "export");
  const caImport = opportunities(grid, "CA", "import");
  const caExport = opportunities(grid, "CA", "export");
  const top = krImport[0];

  const series: LineSeries[] = MARKETS.filter((m) => ["US", "KR", "JP", "EU"].includes(m.code))
    .map((m) => ({
      key: m.code,
      label: m.name,
      points: (() => {
        // A week where a market's scrape read under half its usual count
        // is a partial check (Korea on Sep 8 read 12 listings), not a
        // price move, so it is left off the line.
        const rows = weekly.filter((w) => w.market === m.code && w.p50 != null && w.n >= MIN_N);
        const most = Math.max(0, ...rows.map((w) => w.n));
        return rows.filter((w) => w.n >= most * 0.5).map((w) => ({ x: w.week, y: w.p50 as number, n: w.n }));
      })(),
    }))
    .filter((s) => s.points.length);
  const chartTraits = traits.slice(0, 16);
  if (picked && !chartTraits.includes(picked)) chartTraits.unshift(picked);

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <PageIntro title="Markets">
        Crested gecko asking prices in the United States, South Korea, Japan, Europe and Canada, side by side
        in US dollars. Where a morph asks much less in one market than another, there is room to buy
        there and sell here.
      </PageIntro>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {MARKETS.filter((m) => overall.get(m.code)).map((m) => {
          const c = overall.get(m.code)!;
          const r = rate.get(m.currency);
          return (
            <Stat
              key={m.code}
              label={m.name}
              value={fmtUsd(c.p50)}
              hint={
                <>
                  middle of {fmtInt(c.n)} listings
                  <br />
                  {m.sources}, as of {fmtShortDate(c.asOf)}
                  {r && m.currency !== "USD" ? (
                    <>
                      <br />$1 = {r.perUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} {m.currency}
                    </>
                  ) : null}
                </>
              }
            />
          );
        })}
      </div>

      {top ? (
        <Card className="border-claude/40">
          <div className="text-sm font-medium text-claude-glow">Biggest gap right now</div>
          <p className="mt-1 text-ink-200">
            {top.trait} asks {fmtUsd(top.buy)} in South Korea
            {importMarkup > 1 ? " through Feedle's export store" : ""} and {fmtUsd(top.sell)} in the US. Importing
            pays as long as shipping, import fees and losses stay under {fmtUsd(top.room)} per gecko.
          </p>
        </Card>
      ) : null}

      <Section
        title="South Korea"
        note={`Feedle, a Korean reptile marketplace, and Korean breeder shops. Korean buy prices include the ${Math.round((importMarkup - 1) * 100)}% extra that Feedle's export store charges over the won price; shipping is not included.`}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium text-ink-200">Buy in Korea, sell in the US</h3>
            <OppTable rows={krImport} direction="import" slugOf={slugOf} />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium text-ink-200">Buy in the US, sell in Korea</h3>
            <OppTable rows={krExport} direction="export" slugOf={slugOf} />
          </div>
        </div>
      </Section>

      {jpImport.length || jpExport.length ? (
        <Section
          title="Japan"
          note="Repsuki, a search site listing stock from Japanese reptile shops. Prices include Japanese consumption tax; shipping is not included."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-ink-200">Buy in Japan, sell in the US</h3>
              <OppTable rows={jpImport} direction="import" slugOf={slugOf} />
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-ink-200">Buy in the US, sell in Japan</h3>
              <OppTable rows={jpExport} direction="export" slugOf={slugOf} />
            </div>
          </div>
        </Section>
      ) : null}

      {euImport.length || euExport.length ? (
        <Section title="Europe" note="terraristik.com classifieds and MorphMarket listings in euros.">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-ink-200">Buy in Europe, sell in the US</h3>
              <OppTable rows={euImport} direction="import" slugOf={slugOf} />
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-ink-200">Buy in the US, sell in Europe</h3>
              <OppTable rows={euExport} direction="export" slugOf={slugOf} />
            </div>
          </div>
        </Section>
      ) : null}

      {caImport.length || caExport.length ? (
        <Section title="Canada" note="MorphMarket listings in Canadian dollars.">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-ink-200">Buy in Canada, sell in the US</h3>
              <OppTable rows={caImport} direction="import" slugOf={slugOf} />
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-ink-200">Buy in the US, sell in Canada</h3>
              <OppTable rows={caExport} direction="export" slugOf={slugOf} />
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        title="Every morph, every market"
        note={`Middle asking price in US dollars. "Few" means under ${MIN_N} listings. Blue is cheaper than the US, amber is pricier.`}
      >
        <div className="overflow-x-auto rounded-xl border border-ink-700">
          <table className="plain w-full min-w-[50rem] text-left text-sm">
            <thead className="bg-ink-850 text-ink-400">
              <tr>
                <th className="px-3 py-2 font-medium">Morph</th>
                {MARKETS.map((m) => (
                  <th key={m.code} className="px-3 py-2 font-medium">
                    {m.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums text-ink-300">
              {traits.map((trait) => {
                const row = grid.get(trait)!;
                const slug = slugOf(trait);
                return (
                  <tr key={trait} className="border-t border-ink-800 align-top">
                    <td className="px-3 py-2 text-ink-100">
                      {slug ? (
                        <Link href={`/markets?t=${slug}#over-time`} className="hover:underline">
                          {trait}
                        </Link>
                      ) : (
                        trait
                      )}
                    </td>
                    {MARKETS.map((m) => (
                      <td key={m.code} className="px-3 py-2">
                        <PriceCell cell={row.get(m.code)} us={row.get("US")} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <section id="over-time" className="scroll-mt-24">
        <Section
          title={`${picked ?? "All crested geckos"}: prices over time`}
          note="Middle asking price each week, in US dollars at today's exchange rate, so the lines show local prices moving rather than currencies."
        >
          <div className="space-y-4">
            <nav aria-label="Morph" className="flex flex-wrap gap-2">
              <Chip href="/markets#over-time" active={!picked}>
                All crested
              </Chip>
              {chartTraits.map((t) => {
                const s = slugOf(t);
                return s ? (
                  <Chip key={t} href={`/markets?t=${s}#over-time`} active={picked === t}>
                    {t}
                  </Chip>
                ) : null;
              })}
            </nav>
            <Card>
              {series.length ? (
                <MultiLineChart series={series} maxGapDays={7} />
              ) : (
                <p className="text-ink-300">Not enough weekly history for this morph yet.</p>
              )}
              <p className="mt-3 text-sm text-ink-400">
                The US line goes back to May 2026. Korea and Europe start with the first run of the new
                market scrapers and add a point each week.
              </p>
            </Card>
          </div>
        </Section>
      </section>

      <Section title="How to read this">
        <div className="space-y-3 text-base leading-7 text-ink-300">
          <p>
            These are asking prices, not sales. &quot;Room per gecko&quot; is the gap between the middle
            asking prices of the two markets: the most that shipping, import fees, permits, losses in
            transit and your time can cost before a trade stops paying. It is a place to start looking,
            not a promised profit. Individual animals vary far more than the middle price does.
          </p>
          <p>
            A morph is compared only when both markets have at least {MIN_N} listings of it, and only
            when the gap is at least 20% of the US price. Group lots, sold listings and listings that
            name other gecko species are left out. An Extreme Harlequin counts as Extreme Harlequin
            only, never also as Harlequin, in every market.
          </p>
          <p>
            Crested geckos are not on the CITES lists, so no CITES permits are needed, but moving live
            reptiles between countries still has rules. A commercial import into the US generally needs
            a US Fish and Wildlife Service import license and declaration at a designated port. Check the
            current rules for both countries before buying.
          </p>
          <p>
            Sources: MorphMarket (US, Canada, Europe, UK), Feedle and Korean breeder shops such as Gecko
            Village, New Run Reptile, Crepax, The Monster and Hello Gecko (South Korea), Repsuki, which
            lists stock from Japanese reptile shops (Japan), and terraristik.com classifieds (Europe). Prices
            convert to dollars at the rate stored with each scrape. More in{" "}
            <Link href="/methodology" className="underline hover:text-ink-50">
              how prices work
            </Link>
            .
          </p>
        </div>
      </Section>
    </div>
  );
}
