"use client";
// "The market right now" — five narrated panels that fade in as the user
// scrolls. Pure server-data + IntersectionObserver fade; no scroll-driven
// timeline library needed. Each panel reuses an existing D3 chart from
// src/components/charts/ so we don't reinvent visualization layers.
import dynamic from "next/dynamic";
import ScrollyPanel from "./ScrollyPanel";
import RegionalSpread from "./RegionalSpread";
import type {
  ScrollytellingData,
  ScrollyListing,
} from "@/lib/landing/scrollytelling";

// Charts are SSR-disabled because they mount D3 against a live DOM ref.
const PriceHistogram = dynamic(
  () => import("@/components/charts/PriceHistogram"),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
const RidgePlot = dynamic(() => import("@/components/charts/RidgePlot"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});
const DaysToSellHistogram = dynamic(
  () => import("@/components/charts/DaysToSellHistogram"),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
const CalendarHeatmap = dynamic(
  () => import("@/components/charts/CalendarHeatmap"),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

function ChartSkeleton() {
  return (
    <div className="flex h-72 items-center justify-center rounded-lg bg-ink-900/40 text-xs text-ink-500">
      Loading chart…
    </div>
  );
}

export default function ScrollytellingSection({
  data,
}: {
  data: ScrollytellingData;
}) {
  const histogramData = data.listings.map((l) => ({
    id: l.id,
    price: l.price,
    price_usd_equivalent: l.price_usd_equivalent,
    maturity: l.maturity,
    sex: l.sex,
  }));

  const ridgeData = data.listings.map((l) => ({
    cached_traits: l.cached_traits,
    norm_traits: l.norm_traits,
    price: l.price,
    price_usd_equivalent: l.price_usd_equivalent,
  }));

  const calendarData = data.listings
    .filter((l): l is ScrollyListing & { first_seen_at: string } =>
      Boolean(l.first_seen_at),
    )
    .map((l) => ({ first_seen_at: l.first_seen_at }));

  return (
    <div className="space-y-16">
      <header className="text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-400">
          Long read · The market right now
        </div>
        <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight text-ink-50 md:text-3xl">
          Scroll to read the data tell its own story.
        </h2>
      </header>

      <ScrollyPanel
        eyebrow="Pricing"
        title="Where the market clusters."
        description={
          <>
            Crested gecko prices form a sharply right-skewed distribution —
            most listings sit between the 25th and 75th percentile, with a
            long tail of high-trait specimens above. Filter by maturity and
            sex to see how the shape changes.
          </>
        }
        viz={<PriceHistogram data={histogramData} />}
      />

      <ScrollyPanel
        reverse
        eyebrow="Trait economics"
        title="What people will pay for each trait."
        description={
          <>
            Each ridge is a kernel density estimate of asking prices for
            listings whose traits include the named morph. Wider, flatter
            ridges signal less consensus on value. Tighter, taller ridges
            signal a settled market.
          </>
        }
        viz={<RidgePlot data={ridgeData} />}
      />

      <ScrollyPanel
        eyebrow="Geography"
        title="The market is not flat."
        description={
          <>
            Median ask prices vary materially by region. US and EU sellers
            tend to anchor the price floor; Australia and Japan carry
            premiums tied to import scarcity. Numbers thicken as more sold
            events accumulate.
          </>
        }
        viz={<RegionalSpread cells={data.regional} />}
      />

      <ScrollyPanel
        reverse
        eyebrow="Velocity"
        title="How fast a listing moves."
        description={
          <>
            Days from first listing to sold, across all listings the scraper
            has watched transition. Bumps near 14 and 30 days reflect when
            most listings either close or churn.
          </>
        }
        viz={
          data.days_to_sell.length > 0 ? (
            <DaysToSellHistogram days={data.days_to_sell} />
          ) : (
            <ThinDataNote
              what="Sold-event timing"
              detail="Needs a few weeks of accumulated sold events. The scraper started tracking transitions on May 2026."
            />
          )
        }
      />

      <ScrollyPanel
        eyebrow="Cadence"
        title="When the market is most active."
        description={
          <>
            Each cell is a day, colored by how many new listings landed. The
            pattern shows the weekly and seasonal rhythm of when breeders
            choose to list.
          </>
        }
        viz={
          calendarData.length > 0 ? (
            <CalendarHeatmap data={calendarData} weeks={26} />
          ) : (
            <ThinDataNote
              what="First-seen cadence"
              detail="Needs first_seen_at populated on listings."
            />
          )
        }
      />
    </div>
  );
}

function ThinDataNote({ what, detail }: { what: string; detail: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-ink-700/60 bg-ink-900/40 p-6 text-center">
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
        Data accumulating
      </div>
      <div className="mt-2 text-sm font-medium text-ink-200">{what}</div>
      <div className="mt-1 max-w-xs text-xs leading-5 text-ink-400">
        {detail}
      </div>
    </div>
  );
}
