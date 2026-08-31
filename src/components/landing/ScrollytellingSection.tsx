"use client";
// "The market right now": five narrated panels that fade in as the user
// scrolls. Charts are client D3; the first paint (and no-JS) still gets a
// numeric caption so the panel is not stuck on "Loading chart…".
import PriceHistogram from "@/components/charts/PriceHistogram";
import RidgePlot from "@/components/charts/RidgePlot";
import DaysToSellHistogram from "@/components/charts/DaysToSellHistogram";
import CalendarHeatmap from "@/components/charts/CalendarHeatmap";
import ScrollyPanel from "./ScrollyPanel";
import RegionalSpread from "./RegionalSpread";
import type {
  ScrollytellingData,
  ScrollyListing,
} from "@/lib/landing/scrolly-types";
import { MIN_REGION_LISTINGS } from "@/lib/landing/scrolly-types";
import { fmtUsd } from "@/lib/format";

function chartCaption(text: string) {
  return (
    <p className="mt-2 text-[11px] leading-4 text-ink-500">
      {text} The figure draws in the browser.
    </p>
  );
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
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
  const histPrices = histogramData
    .map((d) => d.price_usd_equivalent ?? d.price)
    .filter((p): p is number => p != null && p > 0 && p < 5000);
  const histMedian = medianOf(histPrices);

  const ridgeData = data.listings.map((l) => ({
    cached_traits: l.cached_traits,
    norm_traits: l.norm_traits,
    price: l.price,
    price_usd_equivalent: l.price_usd_equivalent,
  }));

  const calendarData = data.listings
    .filter((l): l is ScrollyListing & { first_listed_at: string } =>
      Boolean(l.first_listed_at),
    )
    .map((l) => ({ listed_on: l.first_listed_at }));

  const shownRegions = data.region_coverage.filter(
    (r) => r.n_listings >= MIN_REGION_LISTINGS && r.region !== "AU" && r.region !== "JP",
  );
  const regionSummary =
    shownRegions.length > 0
      ? shownRegions
          .map((r) => `${r.region} n=${r.n_listings.toLocaleString()}`)
          .join(", ")
      : "no region currently clears the minimum unique-listing floor";

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
            Crested gecko prices form a sharply right-skewed distribution:
            most listings sit between the 25th and 75th percentile, with a
            long tail of high-trait specimens above. Filter by maturity and
            sex to see how the shape changes.
          </>
        }
        viz={
          <div>
            <PriceHistogram data={histogramData} />
            {chartCaption(
              histPrices.length > 0
                ? `${histPrices.length.toLocaleString()} priced ads in this sample, median ${
                    histMedian != null ? fmtUsd(histMedian) : "n/a"
                  }.`
                : "No priced ads in this sample.",
            )}
          </div>
        }
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
        viz={
          <div>
            <RidgePlot data={ridgeData} />
            {chartCaption(
              `${data.listings.length.toLocaleString()} priced ads feed the ridges.`,
            )}
          </div>
        }
      />

      <ScrollyPanel
        eyebrow="Geography"
        title="Coverage is not a world market."
        description={
          <>
            Priced ads in this catalogue are almost all USD. Regions need at
            least {MIN_REGION_LISTINGS} unique listings before a median is
            shown; CA volume can be a single ad. We do not publish Australia
            or Japan premiums on this coverage. Shown: {regionSummary}.
          </>
        }
        viz={
          <RegionalSpread
            cells={data.regional}
            minListings={MIN_REGION_LISTINGS}
            hideRegions={["AU", "JP"]}
          />
        }
      />

      <ScrollyPanel
        reverse
        eyebrow="Velocity"
        title="How fast a listing moves."
        description={
          <>
            Days from first listing to a recorded sold event. This panel stays
            dark whenever the sold-event stream falls outside its freshness
            guard, so archived timing cannot be read as current demand.
          </>
        }
        viz={
          data.sold_stream_usable && data.days_to_sell.length > 0 ? (
            <DaysToSellHistogram days={data.days_to_sell} />
          ) : (
            <ThinDataNote
              what="Sold-event timing"
              detail={
                data.newest_sold_at
                  ? `Newest recorded sale is ${data.newest_sold_at.slice(0, 10)}. Demand and days-to-sell stay hidden until a catalog recrawl produces new sold inferences.`
                  : "No sold event is on record. Demand and days-to-sell stay hidden."
              }
            />
          )
        }
      />

      <ScrollyPanel
        eyebrow="Cadence"
        title="When the market is most active."
        description={
          <>
            Each cell is a day, colored by how many animals MorphMarket says
            went up for sale on it. Only the {calendarData.length.toLocaleString()} listings
            carrying a list date are counted, because the date our ingest first
            saw a row records when the scraper ran, not when a breeder listed.
          </>
        }
        viz={
          calendarData.length > 0 ? (
            <div>
              <CalendarHeatmap data={calendarData} weeks={26} />
              {chartCaption(
                `${calendarData.length.toLocaleString()} listings with a MorphMarket list date.`,
              )}
            </div>
          ) : (
            <ThinDataNote
              what="First-seen cadence"
              detail="No listing in this sample carries a first_listed_at date, and the date our ingest first saw a row would show when the scraper ran instead."
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
