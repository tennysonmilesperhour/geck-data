// How current are the prices? A plain answer for visitors: when listings
// were last checked, how much of the catalog was rechecked recently, how
// old the sales history is, and what share of listings name their morphs.
// The pipeline detail for the team lives at /status/pipeline.
import Link from "next/link";
import { getDataHealth } from "@/lib/simple/data";
import { Card, Empty, PageIntro, Section, Stat, fmtShortDate } from "@/components/simple/ui";
import { fmtInt } from "@/lib/format";

export const revalidate = 900;

export const metadata = {
  title: "Data status - Geck Inspect Market",
  description: "How current Geck Inspect Market prices are and where the gaps are.",
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export default async function StatusPage() {
  const h = await getDataHealth();
  if (!h) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PageIntro title="Data status" />
        <Empty>Status could not load right now. Try again in a minute.</Empty>
      </div>
    );
  }

  const recentPct = pct(h.recheckedRecently, h.forSale);
  const verdict =
    recentPct >= 60
      ? "Prices are current."
      : recentPct >= 20
        ? "Prices are partly current."
        : "Most prices are out of date.";
  const maxWeek = Math.max(...h.byWeek.map((w) => w.n), 1);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <PageIntro title="Data status">
        <span className="font-medium text-ink-100">{verdict}</span> Listings were last
        checked {fmtShortDate(h.lastChecked)}. {fmtInt(h.recheckedRecently)} of{" "}
        {fmtInt(h.forSale)} listings ({recentPct}%) were rechecked in the two weeks before
        that; the rest were last seen earlier and may have sold or changed price since.
      </PageIntro>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Listings tracked" value={fmtInt(h.forSale)} hint={`Since ${fmtShortDate(h.firstSeen)}`} />
        <Stat label="Rechecked recently" value={`${recentPct}%`} hint={`${fmtInt(h.recheckedRecently)} listings`} />
        <Stat label="Sales on record" value={fmtInt(h.sold)} hint={`${fmtShortDate(h.soldFrom)} to ${fmtShortDate(h.soldTo)}`} />
        <Stat label="Name their morphs" value={`${pct(h.tagged, h.forSale)}%`} hint={`${fmtInt(h.tagged)} listings`} />
      </div>

      <Section title="When listings were last checked" note="Number of current listings by the week they were last seen.">
        <Card className="space-y-2">
          {h.byWeek.map((w) => (
            <div key={w.week} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-sm">
              <span className="text-ink-300">Week of {fmtShortDate(w.week).replace(/, \d{4}$/, "")}</span>
              <span className="h-2 overflow-hidden bg-ink-800">
                <span className="bar-fill block h-full" style={{ width: `${(w.n / maxWeek) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums text-ink-300">{fmtInt(w.n)}</span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="What this means for you">
        <ul className="list-disc space-y-2 pl-5 text-ink-300">
          <li>
            Listings not rechecked recently may have sold or changed price. Each listing card
            shows its own &quot;last checked&quot; date.
          </li>
          <li>
            Sold prices all come from {fmtShortDate(h.soldFrom)} to {fmtShortDate(h.soldTo)}.
            The price check leans on asking prices for anything more recent.
          </li>
          <li>
            Listings that don&apos;t name their morphs still count toward overall prices, but
            not toward any single morph.
          </li>
          <li>
            Breeder pages only cover the {fmtInt(h.withStore)} current listings that name
            their store.
          </li>
        </ul>
      </Section>

      <p className="text-sm text-ink-500">
        Team detail on the scrapers and extension feed:{" "}
        <Link href="/status/pipeline" className="text-ink-300 underline hover:text-ink-100">
          pipeline status
        </Link>
        .
      </p>
    </div>
  );
}
