// Methodology page. Plain-language explanation of every derived metric
// the dashboard renders. The goal is trust: every number on every chart
// links to a paragraph here that explains what it means, what data it
// uses, and what its blind spots are.
//
// Headings get stable ids so other pages can deep-link
// (e.g. /methodology#combo-index).
import Link from "next/link";
import { SectionHeader, Panel } from "@/components/ui/Panel";

export const metadata = {
  title: "Methodology - Geck Inspect Market",
  description:
    "How every number on the Geck Inspect Market dashboard is computed, sourced, and bounded.",
};

export default function MethodologyPage() {
  return (
    <div className="page-rise space-y-8">
      <SectionHeader
        eyebrow="Trust"
        title="Methodology"
        description="Every derived metric on the dashboard is defined here. If a number on a chart confuses you, the chart subtitle should link back to this page."
      />

      <Panel
        tone="soft"
        title="What data we have"
        subtitle="Where every number originates."
      >
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-300">
          <li>
            <strong className="text-ink-100">MorphMarket listings.</strong> The
            primary feed. Scraped daily and supplemented by the Eye in the Sky
            browser extension that emits live events as users browse listings.
            See the daily-log at <Link href="/daily-log" className="underline">/daily-log</Link> for ingest volume.
          </li>
          <li>
            <strong className="text-ink-100">Cross-platform listings.</strong>{" "}
            Fauna Classifieds, Reptile Forums, Preloved, Kijiji. Smaller and
            slower. Surfaces at{" "}
            <Link href="/cross-platform" className="underline">
              /cross-platform
            </Link>.
          </li>
          <li>
            <strong className="text-ink-100">Sold events.</strong> Two flavours:
            <em> confirmed</em> (the extension saw a listing flip from live
            to sold) and <em>inferred</em> (the scraper has not seen a
            listing for 14+ days and the seller has not relisted; we infer
            sale). Both feed the demand-side curves; the difference is
            tagged on every chart that uses sold events.
          </li>
          <li>
            <strong className="text-ink-100">Price history.</strong> A per-listing
            stream of observed prices over time. Used for trend lines and the
            spread analysis on{" "}
            <Link href="/sold" className="underline">
              /sold
            </Link>.
          </li>
        </ul>
      </Panel>

      <section id="median-ask" className="scroll-mt-16"><Panel title="Median ask">
        <p className="text-sm text-ink-300">
          The 50th percentile of currently-live listing prices. Each row's
          price is the USD equivalent when available, falling back to the
          raw listed price otherwise. Excludes prices below $1 and above
          $100,000.
        </p>
        <p className="mt-2 text-sm text-ink-300">
          Median is used in place of mean everywhere on the dashboard
          because the price distribution is heavy-tailed: a single
          $20,000 outlier shifts the mean meaningfully but the median
          barely. The cost of median is that it ignores variance, so
          every panel that quotes a median also displays the sample
          size (n) next to it.
        </p>
      </Panel></section>

      <section id="kde-ridge" className="scroll-mt-16"><Panel title="KDE ridge / density plots">
        <p className="text-sm text-ink-300">
          A KDE (kernel density estimate) ridge is a smooth histogram. It
          shows where listings cluster in price by trait. Wider ridge = more
          dispersion (the market is undecided), narrower ridge = tighter
          pricing.
        </p>
        <p className="mt-2 text-sm text-ink-300">
          Implementation: epanechnikov kernel, bandwidth scaled with sample
          size. Below n=10 the ridge fades; below n=5 it is hidden.
        </p>
      </Panel></section>

      <section id="days-to-sell" className="scroll-mt-16"><Panel title="Days to sell">
        <p className="text-sm text-ink-300">
          From the listing's first observation (either MorphMarket's first
          listed date, when we have it, or our scrape's first seen at) to
          its sold event. Listings still live show up as null in the
          histogram and are excluded.
        </p>
      </Panel></section>

      <section id="arbitrage" className="scroll-mt-16"><Panel title="Arbitrage flag">
        <p className="text-sm text-ink-300">
          When the same animal (matched by image pHash) appears on both
          MorphMarket and a cross-platform listing at materially
          different prices, we flag it as a candidate arbitrage. The match
          is best-effort: pHash collisions exist and listings can be
          legitimately the same animal at different stages of life. Treat
          as a heads-up, not a confirmation.
        </p>
      </Panel></section>

      <section id="market-index" className="scroll-mt-16"><Panel title="Geck Inspect Market Index">
        <p className="text-sm text-ink-300">
          Weekly weighted basket of high-value combos. Geometric average
          across all anchor combos that had a sale that week, normalised
          so the oldest week in the window = 1000.
        </p>
        <p className="mt-2 text-sm text-ink-300">
          Definition lives in <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">v_market_index</code>{" "}
          (migration 0005). Weeks with fewer than 2 combos are excluded
          from the geometric average; the resulting weeks are shaded on
          the chart when sample size dips below 4.
        </p>
      </Panel></section>

      <section id="sub-index" className="scroll-mt-16"><Panel title="Anchor morph sub-indices">
        <p className="text-sm text-ink-300">
          Per-anchor weekly median price, rebased to 1000 at the start of
          the window. Anchors are coarse morph families: Lilly White,
          Axanthic, Harlequin, Cappuccino (the last grouping Cappuccino,
          Sable, and Frappuccino because they share parentage and price
          together in practice).
        </p>
        <p className="mt-2 text-sm text-ink-300">
          A listing can contribute to multiple anchors. The view is
          <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">v_market_sub_index</code> (migration 0035).
        </p>
      </Panel></section>

      <section id="combo-index" className="scroll-mt-16"><Panel title="Per-combo index">
        <p className="text-sm text-ink-300">
          Daily median sold price per canonical combo. Available for the
          dozen canonical high-value combos. Powered by the materialised
          view{" "}
          <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">combo_index_daily</code>{" "}
          (migration 0035), refreshed nightly. The summary view{" "}
          <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">v_combo_index_summary</code>{" "}
          adds 7d / 30d / 90d deltas.
        </p>
      </Panel></section>

      <section id="confidence" className="scroll-mt-16"><Panel title="Confidence score (0..99)">
        <p className="text-sm text-ink-300">
          A coarse 0..99 score attached to every derived number. It
          aggregates two signals: sample size and source mix. Sample size
          dominates below n=20; source mix matters more above. Visually,
          confidence renders as a coloured pip (red below 25, amber up to
          50, green above 80).
        </p>
      </Panel></section>

      <section id="source-attribution" className="scroll-mt-16"><Panel title="Source attribution">
        <p className="text-sm text-ink-300">
          Every chart tags which source bundles contributed: MorphMarket
          listings, MorphMarket sold events, breeder direct, Pangea, Fauna
          Classifieds, Kijiji, etc. The catalogue lives in{" "}
          <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">src/lib/market/sources.ts</code>.
          The <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">sources</code>{" "}
          filter on every page is the same control, so narrowing to just
          MorphMarket sold events (for example) is one click everywhere.
        </p>
      </Panel></section>

      <section id="adjustments" className="scroll-mt-16"><Panel title="Price adjustments (What's it worth)">
        <p className="text-sm text-ink-300">
          The price estimator on{" "}
          <Link href="/whats-it-worth" className="underline">
            /whats-it-worth
          </Link>{" "}
          takes the combo's base percentile band (p10/p25/p50/p75/p90 of
          sold listings in the last 180 days) and multiplies through by a
          set of adjustment factors that account for age, sex, weight, and
          proven-breeder status. Factors live in{" "}
          <code className="rounded bg-ink-850 px-1 py-0.5 text-xs">price_adjustment_factors</code>{" "}
          (migration 0033) and are refreshed when the empirical data
          accumulates enough samples per bucket.
        </p>
      </Panel></section>

      <Panel tone="soft" title="Limits we want to call out">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-400">
          <li>
            Region inference is location-string regex based. A "Seattle, WA"
            seller maps to US; a "London" seller to UK. False negatives are
            common; refine if you spot one.
          </li>
          <li>
            Sold-inferred events are noisy. A listing pulled because the
            seller went on vacation reads as a sale in our pipeline. The
            14-day rule is tuned empirically and will move.
          </li>
          <li>
            Trait normalisation is a moving target. The taxonomy table
            (<code className="rounded bg-ink-850 px-1 py-0.5 text-xs">morph_taxonomy_synonyms</code>)
            holds the alias mappings; if you see "Lilly White" not matching
            a listing that has it, send the listing URL.
          </li>
        </ul>
      </Panel>

      <p className="text-xs text-ink-500">
        Last reviewed: 2026-05-22. Every claim here has a corresponding
        SQL view or function path. If a chart copy says something the
        methodology page does not back up, that is a bug in the chart
        copy; please flag it.
      </p>
    </div>
  );
}
