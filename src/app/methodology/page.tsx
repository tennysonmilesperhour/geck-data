// Methodology. Plain-language explanation of every derived number on the
// site, including the ones we cannot currently produce.
//
// Rewritten 2026-08-29. The previous version was last reviewed 2026-05-22 and
// described a pipeline that no longer exists: a daily scrape, a browser
// extension feeding live events, a 14 day sold-inference rule that was never
// what the code did, a twelve-combo market view, and pHash cross-platform
// arbitrage that no live page runs. Every one of those has been corrected
// here rather than quietly dropped, because a visitor who read the old page
// was told something specific and wrong.
//
// Headings keep their stable ids so other pages can deep-link
// (e.g. /methodology#combo-index).
import Link from "next/link";
import { SectionHeader, Panel } from "@/components/ui/Panel";

export const metadata = {
  title: "Methodology - Geck Inspect Market",
  description:
    "How every number on the Geck Inspect Market dashboard is computed, what it is measured over, and where the gaps are.",
};

export default function MethodologyPage() {
  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Trust"
        title="Methodology"
        description="What each number means, what it is measured over, and what it cannot tell you. If a chart says something this page does not back up, the chart is wrong."
      />

      <section id="coverage" className="scroll-mt-16">
        <Panel tone="soft" title="Read this first: coverage">
          <p className="text-sm text-ink-300">
            Everything on this site is built from observations of MorphMarket
            listings. We can only describe the market on days we actually
            looked at it, and collection has not been continuous.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-300">
            <li>
              <strong className="text-ink-100">
                There is a 78 day hole, 2026-06-10 to 2026-08-26.
              </strong>{" "}
              The scraper stopped and nothing was recorded. That period is
              absent from every chart, drawn as a break rather than as zero,
              because a market we did not watch is not a market with no
              activity.
            </li>
            <li>
              <strong className="text-ink-100">The feed is weekly.</strong> A
              MorphMarket API ingest runs on Mondays. It is not daily, and this
              page used to say daily.
            </li>
            <li>
              <strong className="text-ink-100">
                Most listings marked live have not been re-checked recently.
              </strong>{" "}
              A listing stays flagged live until something tells us otherwise,
              and the last full pass covered a small share of the catalogue.
              Pages that quote a live count or a current median say which
              population they mean: re-confirmed recently, or last confirmed
              months ago.
            </li>
            <li>
              <strong className="text-ink-100">
                Sales stopped being observed on 2026-06-07.
              </strong>{" "}
              Anything about demand, velocity or time to sell is history, not a
              current reading, and several such widgets now decline to render
              rather than imply otherwise.
            </li>
          </ul>
          <p className="mt-3 text-sm text-ink-300">
            The live state of all of this is on{" "}
            <Link href="/status" className="underline">
              /status
            </Link>
            , and the header shows the same verdict on every page.
          </p>
        </Panel>
      </section>

      <section id="data-sources" className="scroll-mt-16">
        <Panel title="Where the data comes from">
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink-300">
            <li>
              <strong className="text-ink-100">MorphMarket listings.</strong>{" "}
              The only feed currently running. A weekly job reads MorphMarket&apos;s
              public JSON API for crested geckos listed in the previous seven
              days and records price, traits, seller and dates.
            </li>
            <li>
              <strong className="text-ink-100">
                The older scrape archive.
              </strong>{" "}
              A denser HTML scrape ran from 2026-05-09 to 2026-06-09 and then
              failed permanently. Most of the catalogue and nearly all of the
              sales history come from that month.
            </li>
            <li>
              <strong className="text-ink-100">
                The Eye in the Sky extension.
              </strong>{" "}
              A browser extension that reported listing events. It has sent
              nothing since 2026-05-14. Numbers that depend on it are frozen at
              that date and are labelled where they appear.
            </li>
            <li>
              <strong className="text-ink-100">Cross-platform listings.</strong>{" "}
              Never populated in practice. The{" "}
              <Link href="/cross-platform" className="underline">
                page
              </Link>{" "}
              exists but has no feed behind it.
            </li>
          </ul>
        </Panel>
      </section>

      <section id="prices" className="scroll-mt-16">
        <Panel title="What a price on this site is">
          <p className="text-sm text-ink-300">
            Every price here is an <strong className="text-ink-100">asking
            price</strong> that we observed on a listing. MorphMarket does not
            publish what an animal actually changed hands for, and we have no
            way to see a negotiated price. When a page says a gecko &quot;sold
            for&quot; an amount, it means that was the last asking price we saw
            before the listing went away.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            Prices are compared in USD. Where a listing is in another currency
            we use the USD equivalent recorded at ingest, and rows without one
            are excluded from price statistics rather than mixed in at face
            value.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            Multi-animal listings (lots, packs, pairs, trios, group sales) are
            flagged and excluded from per-animal medians, comps and discount
            calculations, because their price covers several animals. They stay
            visible when browsing.
          </p>
        </Panel>
      </section>

      <section id="median-ask" className="scroll-mt-16">
        <Panel title="Median ask">
          <p className="text-sm text-ink-300">
            The 50th percentile of observed asking prices. Median rather than
            mean, because the distribution has a long tail and a single $20,000
            animal moves a mean noticeably while barely touching a median. Any
            panel quoting a median also shows the sample size it came from.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            <strong className="text-ink-100">One listing, one vote.</strong>{" "}
            The same listing is often re-observed many times, up to fourteen
            times in a single day. Feeding every observation into a median lets
            a frequently re-scraped listing outweigh an identical one seen
            once, so cross-sectional medians first reduce to one observation
            per listing per period. Panels report unique listings as the sample
            size, separately from the raw observation count.
          </p>
        </Panel>
      </section>

      <section id="sold" className="scroll-mt-16">
        <Panel title="Sold data, and its two definitions">
          <p className="text-sm text-ink-300">
            There are two separate pools of sales, and they are never added
            together, because they are different kinds of evidence.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-300">
            <li>
              <strong className="text-ink-100">Captured events.</strong> The
              pipeline watched a listing change to sold. There are 92 of these
              in total, all observed between 2026-05-11 and 2026-05-14.
            </li>
            <li>
              <strong className="text-ink-100">Inferred sales.</strong> A
              listing stopped appearing in the catalogue walk, so we infer it
              sold. There are about 2,840 of these, dated 2026-05-17 to
              2026-06-07. A listing can leave for other reasons, including the
              seller pulling it, so this pool is suggestive rather than
              certain.
            </li>
          </ul>
          <p className="mt-3 text-sm text-ink-300">
            The previous version of this page described the inference as
            &quot;the scraper has not seen a listing for 14 or more days and
            the seller has not relisted&quot;. That was never the rule in the
            code. The job flagged everything not seen since the run began, with
            no grace period, and it no longer runs at all.
          </p>
        </Panel>
      </section>

      <section id="days-to-sell" className="scroll-mt-16">
        <Panel title="Days to sell">
          <p className="text-sm text-ink-300">
            The gap between when we first saw a listing and when it sold. This
            is only meaningful when we actually watched that interval elapse.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            For 84 of the 92 captured events, the first sighting and the sale
            were written by the same bulk import, so the apparent duration is
            zero. That is a fact about our import, not about how fast the
            animal sold, and it is why this site once advertised a median time
            to sell of zero days. Where first sighting and sale land within an
            hour of each other the duration is now null, and medians are
            computed only over the rows that remain, with that count shown.
          </p>
        </Panel>
      </section>

      <section id="combo-index" className="scroll-mt-16">
        <Panel title="Combos and the per-combo index">
          <p className="text-sm text-ink-300">
            A combo is a pair of traits observed together on listings. Pairs
            are discovered from the trait tags themselves, not from a curated
            list. Two filters run before a pair is charted:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-300">
            <li>
              <strong className="text-ink-100">
                Pairs that are really one trait are excluded.
              </strong>{" "}
              Extreme Harlequin with Harlequin, Dalmatian with Super Dalmatian,
              Axanthic with Het Axanthic, Red with Red Base: these are one
              trait described at a different expression level, a zygosity
              state, or under an overlapping label. They are not a pairing a
              breeder can make, and charting them as combos invents an economic
              relationship. Cappuccino, Sable and Frappuccino are treated as
              one family for the same reason.
            </li>
            <li>
              <strong className="text-ink-100">
                A pair needs more than one seller behind it.
              </strong>{" "}
              One breeder listing a project repeatedly is that breeder&apos;s
              pricing, not a market. Panels show the unique listing and unique
              seller counts so you can judge the evidence yourself.
            </li>
          </ul>
          <p className="mt-3 text-sm text-ink-300">
            The per-combo index is the daily median observed asking price for
            each combo. It is built from asking-price observations, not from
            confirmed sales, because the sales stream is far too thin to
            support a daily series. That is the same choice Zillow makes with
            its home value index, and it is only honest if we say so: this
            tracks what sellers ask, not what buyers pay.
          </p>
        </Panel>
      </section>

      <section id="deltas" className="scroll-mt-16">
        <Panel title="Why a change can read as unavailable">
          <p className="text-sm text-ink-300">
            A 7, 30 or 90 day change needs an observation at both ends. Ours
            are anchored to each combo&apos;s own most recent observation, not
            to today&apos;s date, and the earlier end has to fall inside the
            window being claimed.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            When no observation exists at the far end, the cell reads{" "}
            <strong className="text-ink-100">no baseline</strong>. When the
            combo has not been seen recently at all, it reads{" "}
            <strong className="text-ink-100">stale</strong>. Neither is a
            measured zero. Before this rule existed the page compared a combo
            against its own latest row and published &quot;+0.0%&quot; for over
            a thousand combos, which reads as a flat market rather than as
            missing data.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            Because of the 78 day collection gap, no combo currently has a 7 or
            30 day baseline. The 90 day column does have real comparisons in
            it, between observations at the end of May and the end of August.
          </p>
        </Panel>
      </section>

      <section id="market-index" className="scroll-mt-16">
        <Panel title="Market index and anchor sub-indices">
          <p className="text-sm text-ink-300">
            The composite index is a weekly basket across anchor morph
            families, rebased so the first week in the window is 1000. Anchors
            are coarse groupings: Lilly White, Axanthic, Harlequin, and the
            Cappuccino family. A listing can count toward more than one anchor.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            The sub-indices rest on a handful of observed weeks spread across
            four months, not on a continuous series. Where a chart would have
            to draw a straight line across months nobody observed, it breaks
            instead, and the observed-week count is shown next to it. The
            headline composite index needs at least two weeks of sold-based
            data to compute and currently has one, so it renders an empty state
            rather than a number.
          </p>
        </Panel>
      </section>

      <section id="temperature" className="scroll-mt-16">
        <Panel title="Market temperature">
          <p className="text-sm text-ink-300">
            A 0 to 100 composite of sold price, sell-through and time to sell,
            ranked against the preceding year. It only means something while
            sales are being observed.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            It used to fill missing components with zero, which made every
            component land at the neutral midpoint and produced a confident
            &quot;50, Warm&quot; out of no evidence at all. It now requires a
            minimum number of recent captured sales and a baseline with real
            spread, and returns no score with a stated reason when those are
            not met. Today it returns no score.
          </p>
        </Panel>
      </section>

      <section id="adjustments" className="scroll-mt-16">
        <Panel title="Price bands on What's it worth">
          <p className="text-sm text-ink-300">
            <Link href="/whats-it-worth" className="underline">
              /whats-it-worth
            </Link>{" "}
            takes the percentile band of past listings carrying the traits you
            select, then applies multiplicative adjustments for age, sex,
            weight and proven-breeder status.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            The band draws on both sold pools described above, with the counts
            reported separately so you can see whether it rests on watched
            transitions or on inferred ones. Because both pools are last
            observed asking prices, the output is an asking-price range, not an
            appraisal, and every comp in it is currently from May or June 2026.
          </p>
        </Panel>
      </section>

      <section id="confidence" className="scroll-mt-16">
        <Panel title="Confidence and sample size">
          <p className="text-sm text-ink-300">
            Confidence chips are a statement about sample size and nothing
            else. They scale with the number of observations behind a figure
            and reach the top of the range only in the low hundreds. They do
            not account for how old the data is, which is what the coverage
            note at the top of this page is for. A high confidence chip on a
            three month old number still means a three month old number.
          </p>
        </Panel>
      </section>

      <section id="regions" className="scroll-mt-16">
        <Panel title="Regions">
          <p className="text-sm text-ink-300">
            Region comes from parsing a free-text seller location, and roughly
            85% of listings have no location at all. What can be mapped is
            almost entirely US. There is not enough here to compare regions or
            to claim an arbitrage opportunity between them, so the regional
            filters are disabled rather than left to return the same rows under
            a different label.
          </p>
          <p className="mt-2 text-sm text-ink-300">
            The previous version of this page described matching the same
            animal across marketplaces by image hash to flag arbitrage. No live
            page does that.
          </p>
        </Panel>
      </section>

      <section id="known-gaps" className="scroll-mt-16">
        <Panel tone="soft" title="Known gaps we have not closed">
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink-400">
            <li>
              Trait vocabulary is still messy. Tags come from sellers, and
              synonyms, misspellings and house names are not fully reconciled.
            </li>
            <li>
              A listing marked live has not necessarily been re-checked. Until
              a full catalogue pass runs again, live counts describe what we
              last saw rather than what is for sale today.
            </li>
            <li>
              Monthly reports are computed when you open them, from current
              data, rather than frozen at month end. A month can therefore read
              differently on two visits.
            </li>
            <li>
              Breeding and lineage data is not collected, so nothing here can
              tell you what a pairing is likely to produce.
            </li>
          </ul>
        </Panel>
      </section>

      <p className="text-xs text-ink-500">
        Last reviewed: 2026-08-29. Every claim on this page maps to a query or
        a view in the codebase. If a chart says something this page does not
        back up, that is a bug in the chart, and we would like to know.
      </p>
    </div>
  );
}
