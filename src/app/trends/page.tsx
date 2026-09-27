// How the crested gecko market moved week by week: asking prices, price
// cuts and raises, and listings going up and coming down. For the whole
// market or one morph.
//
// The history has holes (tracking started in May 2026 and the scraper was
// blocked from June to late August). The page says so plainly and draws
// the holes as holes.
import { Fragment } from "react";
import Link from "next/link";
import { getMarketTrend, getMorphs, type TrendWeek } from "@/lib/simple/data";
import { fmtWeek, priceChange, saleWeek, untracked, weekTime } from "@/lib/simple/trend";
import { Card, Chip, PageIntro, Section, Stat, TextLink } from "@/components/simple/ui";
import { PriceTrendChart, WeeklyBars } from "@/components/simple/TrendCharts";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 3600;

export const metadata = {
  title: "Trends - Geck Inspect Market",
  description:
    "How crested gecko asking prices, price cuts and new listings changed week by week, for the whole market or one morph.",
};

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;

/** True when the week starting `w` contains Memorial Day (last Monday of May). */
function hasMemorialDay(w: string): boolean {
  const start = weekTime(w);
  const year = new Date(start).getUTCFullYear();
  const may31 = Date.UTC(year, 4, 31);
  const dow = new Date(may31).getUTCDay();
  const memorial = may31 - ((dow + 6) % 7) * 86_400_000;
  // Sunday scrapes land on the Sunday before the holiday Monday.
  return memorial >= start && memorial <= start + 8 * 86_400_000;
}

function SaleNote({ weeks }: { weeks: TrendWeek[] }) {
  const s = saleWeek(weeks);
  if (!s) return null;
  const rebound = s.raisesNext != null && s.raisesNext >= s.cuts * 0.5;
  return (
    <Card className="border-claude/40">
      <div className="text-sm font-medium text-claude-glow">
        Sale week{hasMemorialDay(s.week) ? ", around Memorial Day" : ""}
      </div>
      <p className="mt-1 text-ink-200">
        In the week of {fmtWeek(s.week, true)}, {fmtInt(s.cuts)} listings cut their price
        {s.medianCut != null ? `, by a typical ${pct(s.medianCut)}` : ""}. That is more than twice a
        normal week.
        {rebound
          ? ` The next week ${fmtInt(s.raisesNext!)} listings raised their price again, so most of these were temporary sale prices, not a falling market.`
          : ""}
      </p>
    </Card>
  );
}

export default async function TrendsPage({ searchParams }: { searchParams: { t?: string } }) {
  const morphs = await getMorphs();
  const picked = searchParams.t ? morphs.find((m) => m.slug === searchParams.t) ?? null : null;
  const weeks = await getMarketTrend(picked?.trait ?? null);
  const name = picked ? picked.trait : "All crested geckos";
  const change = priceChange(weeks);
  const gaps = untracked(weeks);
  const full = weeks.filter((w) => !w.partial);
  const latest = weeks[weeks.length - 1];
  const topMorphs = [...morphs].sort((a, b) => b.forSale + b.sold - (a.forSale + a.sold)).slice(0, 18);
  if (picked && !topMorphs.some((m) => m.slug === picked.slug)) topMorphs.push(picked);

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <PageIntro title="Trends">
        How crested gecko asking prices and listings moved week by week. Pick a morph to see its
        own history.
      </PageIntro>

      <nav aria-label="Morph" className="flex flex-wrap gap-2">
        <Chip href="/trends" active={!picked}>
          All crested
        </Chip>
        {topMorphs.map((m) => (
          <Chip key={m.slug} href={`/trends?t=${m.slug}`} active={picked?.slug === m.slug}>
            {m.trait}
          </Chip>
        ))}
      </nav>

      {weeks.length < 2 ? (
        <Card>
          <p className="text-ink-300">
            Not enough history for {name} yet. Each week the scraper runs adds a point here.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Middle asking price"
              value={change ? fmtUsd(change.to.p50) : fmtUsd(full[full.length - 1]?.p50 ?? null)}
              hint={change ? `week of ${fmtWeek(change.to.week)}` : undefined}
            />
            <Stat
              label="Change"
              value={
                change
                  ? Math.abs(change.pct) < 0.02
                    ? "Flat"
                    : `${change.pct > 0 ? "Up" : "Down"} ${pct(change.pct)}`
                  : "no data"
              }
              hint={change ? `since week of ${fmtWeek(change.from.week)}` : "needs two full weeks"}
            />
            <Stat label="Weeks tracked" value={fmtInt(weeks.length)} hint={`${fmtInt(full.length)} full checks`} />
            <Stat
              label="Latest check"
              value={fmtWeek(latest.week, true)}
              hint={latest.partial ? `partial, ${fmtInt(latest.seen)} listings` : `${fmtInt(latest.seen)} listings`}
            />
          </div>

          <Section
            title={`${name}: asking price over time`}
            note="Each point is one week. The line is the middle asking price, the band covers the middle half of prices."
          >
            <Card>
              <PriceTrendChart weeks={weeks} label={name} />
            </Card>
          </Section>

          <SaleNote weeks={weeks} />

          <Section
            title="Price cuts and raises"
            note="Listings whose price went down or up since the check before."
          >
            <Card>
              <WeeklyBars weeks={weeks} kind="changes" />
            </Card>
          </Section>

          <Section
            title="Listings going up and coming down"
            note="Only counted when the week before was also a full check, so a restart never reads as a flood of new geckos."
          >
            <Card>
              <WeeklyBars weeks={weeks} kind="flow" />
              <p className="mt-3 text-sm text-ink-400">
                &quot;Came down&quot; means the listing disappeared from MorphMarket. Most are sales, but a
                seller can also pull a listing.
              </p>
            </Card>
          </Section>

          <Section title="Every tracked week">
            <div className="overflow-x-auto rounded-xl border border-ink-700">
              <table className="plain w-full min-w-[40rem] text-left text-sm">
                <thead className="bg-ink-850 text-ink-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Week of</th>
                    <th className="px-3 py-2 text-right font-medium">Checked</th>
                    <th className="px-3 py-2 text-right font-medium">Middle price</th>
                    <th className="px-3 py-2 text-right font-medium">Middle half</th>
                    <th className="px-3 py-2 text-right font-medium">Cuts</th>
                    <th className="px-3 py-2 text-right font-medium">Raises</th>
                    <th className="px-3 py-2 text-right font-medium">New</th>
                    <th className="px-3 py-2 text-right font-medium">Came down</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-ink-200">
                  {weeks.map((w, i) => {
                    const gap = gaps.find((g) => g.to === w.week);
                    return (
                      <Fragment key={w.week}>
                        {gap ? (
                          <tr className="border-t border-ink-800 text-ink-500">
                            <td colSpan={8} className="px-3 py-2 italic">
                              {gap.weeks} {gap.weeks === 1 ? "week" : "weeks"} not tracked
                            </td>
                          </tr>
                        ) : null}
                        <tr className={`border-t border-ink-800 ${w.partial ? "text-ink-400" : ""}`}>
                          <td className="px-3 py-2">
                            {fmtWeek(w.week, i === 0 || gap != null)}
                            {w.partial ? <span className="ml-2 text-xs text-ink-500">partial</span> : null}
                          </td>
                          <td className="px-3 py-2 text-right">{fmtInt(w.seen)}</td>
                          <td className="px-3 py-2 text-right">{fmtUsd(w.p50)}</td>
                          <td className="px-3 py-2 text-right">
                            {w.p25 != null && w.p75 != null ? `${fmtUsd(w.p25)} to ${fmtUsd(w.p75)}` : ""}
                          </td>
                          <td className="px-3 py-2 text-right">{w.afterGap ? "" : fmtInt(w.cuts)}</td>
                          <td className="px-3 py-2 text-right">{w.afterGap ? "" : fmtInt(w.raises)}</td>
                          <td className="px-3 py-2 text-right">{w.newListings == null ? "" : fmtInt(w.newListings)}</td>
                          <td className="px-3 py-2 text-right">{w.cameDown == null ? "" : fmtInt(w.cameDown)}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <Section title="About this history">
        <div className="space-y-3 text-base leading-7 text-ink-300">
          <p>
            Tracking began in May 2026. Each week the scraper checks every crested gecko listing and
            records its price, so a week here is one pass over the market.
            {gaps.length
              ? ` From ${fmtWeek(gaps[0].from, true)} to ${fmtWeek(gaps[0].to, true)} the scraper was blocked, so those weeks are missing rather than guessed.`
              : ""}
          </p>
          <p>
            A partial check (a hollow dot) covered less than half the market, so its price rests on a
            small sample. Group lots and prices outside US dollars are left out. Asking prices are what
            sellers ask, not what buyers paid.
          </p>
          <p>
            {picked ? (
              <>
                More on this morph: <TextLink href={`/morphs/${picked.slug}`}>{picked.trait} prices</TextLink>.{" "}
              </>
            ) : null}
            How every number is worked out: <Link href="/methodology" className="underline hover:text-ink-50">how prices work</Link>.
          </p>
        </div>
      </Section>
    </div>
  );
}
