"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ChartGrid from "@/components/charts/ChartGrid";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import DataFreshness from "@/components/ui/DataFreshness";
import { fmtDate, fmtInt, fmtUsd, newestIso } from "@/lib/format";
import SoldPriceDistribution from "./SoldPriceDistribution";
import SoldByMaturity from "./SoldByMaturity";
import SoldFilters from "./SoldFilters";
import SortableSoldTable, { type SoldBasis } from "./SortableSoldTable";
import SourceFootnote from "@/components/ui/SourceFootnote";
import {
  applySoldFilters,
  type SoldFilters as SoldFilterState,
} from "@/lib/sold/filters";
import type { SoldActivityWeek } from "@/lib/sold/activity";
import type { SoldPool } from "@/lib/sold/data";

const DAY_MS = 86_400_000;

// Below this many measurable rows a median time-to-sell says more about the
// import schedule than about the market, so the tile prints the reason
// instead of a number. The captured pool has 8 such rows today.
const MIN_MEASURABLE_DAYS = 20;

const POOL_META: Record<
  SoldBasis,
  { title: string; noun: string; definition: string }
> = {
  captured_event: {
    title: "Captured sold events",
    noun: "captured sold events",
    definition:
      "The pipeline observed the listing flip to sold and wrote a status event. Strongest evidence, smallest pool.",
  },
  inferred_unseen: {
    title: "Inferred sold records",
    noun: "inferred sold records",
    definition:
      "The catalogue walk stopped seeing the listing, so a sale is inferred from its absence. No sale was observed, and a listing can also vanish because the seller pulled it.",
  },
};

export default function SoldDashboard({
  captured,
  inferred,
  soldActivity,
  generatedAt,
}: {
  captured: SoldPool;
  inferred: SoldPool;
  soldActivity: SoldActivityWeek[];
  generatedAt: string;
}) {
  const [filters, setFilters] = useState<SoldFilterState>({});
  // Captured events are the default because they are the pool where a sale
  // was actually witnessed. The inferred pool is one click away and its size
  // is on screen either way, so neither is hidden behind the other.
  const [basis, setBasis] = useState<SoldBasis>("captured_event");
  const { morph, maturity, sex } = filters;

  const pool = basis === "captured_event" ? captured : inferred;
  const meta = POOL_META[basis];

  const rows = useMemo(
    () => applySoldFilters(pool.rows, { morph, maturity, sex }),
    [pool, maturity, morph, sex],
  );
  const filtered = rows.length !== pool.rows.length;
  const filterSummary = [morph, maturity, sex].filter(Boolean).join(" · ");

  // A group lot prices several animals at once, so it belongs in neither the
  // median nor the histogram. It stays in the table, tagged.
  const singles = rows.filter((row) => !row.is_group_lot);
  const groupLotsInSlice = rows.length - singles.length;
  const medianAsk = median(
    singles.map((row) => row.price_usd_equivalent ?? row.price),
  );

  // Unfiltered, the median runs over every measurable row in the pool, not
  // just the loaded slice. Filtered, only the slice can answer.
  const sliceDays = rows
    .map((row) => row.days_to_sell)
    .filter((day): day is number => typeof day === "number" && day >= 0);
  const daysSample = filtered ? sliceDays : pool.measurableDays;
  const medianDays = daysSample ? median(daysSample) : null;
  const daysDenominator = filtered ? rows.length : pool.total;

  const nowMs = Number.isFinite(Date.parse(generatedAt))
    ? Date.parse(generatedAt)
    : Date.now();
  const newestAny = newestIso(captured.newestSoldAt, inferred.newestSoldAt);
  const oldestAny = oldestIso(captured.oldestSoldAt, inferred.oldestSoldAt);
  const newestAgeDays =
    newestAny && Number.isFinite(Date.parse(newestAny))
      ? Math.max(0, Math.round((nowMs - Date.parse(newestAny)) / DAY_MS))
      : null;

  return (
    <div className="page-rise space-y-8">
      <Suspense fallback={null}>
        <SearchParamsSync onChange={setFilters} />
      </Suspense>

      <SectionHeader
        eyebrow="Outcomes / Comps"
        title="Sold"
        description="Two separate records of listings leaving the market: sales the pipeline watched happen, and sales inferred from a listing going missing. They are counted apart because they are not the same evidence."
        right={
          <DataFreshness
            updatedAt={newestAny}
            window={
              oldestAny && newestAny
                ? `${fmtDate(oldestAny)} to ${fmtDate(newestAny)}`
                : "unknown"
            }
          />
        }
      />

      <section className="rounded-md border border-busy/40 bg-busy/10 p-4 text-sm text-ink-200">
        <p>
          <span className="font-semibold text-busy">
            This page is an archive, not a current view of demand.
          </span>{" "}
          {newestAny && newestAgeDays != null
            ? `The newest sale of any kind on record is ${fmtDate(newestAny)}, about ${fmtInt(newestAgeDays)} days ago. Nothing has been observed selling since, so no number here describes the market today.`
            : "No sale on record carries a usable date, so nothing here can be aged or trusted as current."}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-[20px] font-medium tracking-tight text-ink-50">
          The two sold pools
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[captured, inferred].map((p) => (
            <PoolCard
              key={p.basis}
              pool={p}
              selected={p.basis === basis}
              onSelect={() => setBasis(p.basis)}
            />
          ))}
        </div>
        <p className="text-xs text-ink-400">
          Never add these together. A captured event means a sale was seen; an
          inferred record means a listing stopped appearing, which can also
          happen when a seller pulls an animal. Everything below this line shows
          one pool at a time: currently {meta.noun}.
        </p>
      </section>

      <SoldFilters current={filters} />

      {filtered ? (
        <p className="text-sm text-ink-400">
          Showing {fmtInt(rows.length)} of {fmtInt(pool.rows.length)} loaded{" "}
          {meta.noun} narrowed by {filterSummary}. The distribution, cohort
          panel, and table all reflect this slice.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={filtered ? `${meta.title} (filtered)` : meta.title}
          value={filtered ? fmtInt(rows.length) : fmtInt(pool.total)}
          sub={
            filtered
              ? `of ${fmtInt(pool.rows.length)} loaded, ${fmtInt(pool.total)} in the pool`
              : pool.total > pool.rows.length
                ? `${fmtInt(pool.rows.length)} most recent loaded on this page`
                : "every row in the pool is loaded here"
          }
        />
        <KpiCard
          label="Median last observed ask"
          value={medianAsk == null ? "No priced rows" : fmtUsd(medianAsk)}
          sub={
            medianAsk == null
              ? "nothing in this slice carries a price"
              : `n = ${fmtInt(singles.length)} priced rows${groupLotsInSlice > 0 ? `, ${fmtInt(groupLotsInSlice)} group lots excluded` : ""}`
          }
        />
        <KpiCard
          label="Median time to sell"
          value={
            daysSample == null
              ? "Unavailable"
              : daysSample.length < MIN_MEASURABLE_DAYS || medianDays == null
                ? "Not measurable"
                : `${Math.round(medianDays)} d`
          }
          sub={
            daysSample == null
              ? "the days-to-sell column could not be read"
              : daysSample.length < MIN_MEASURABLE_DAYS || medianDays == null
                ? `only ${fmtInt(daysSample.length)} of ${fmtInt(daysDenominator)} rows were first seen before the day they sold`
                : `median over ${fmtInt(daysSample.length)} measurable rows${filtered ? " in this slice" : " across the pool"}`
          }
        />
        <KpiCard
          label="Newest sale in pool"
          value={
            pool.newestSoldAt ? fmtDate(pool.newestSoldAt) : "No dated sale"
          }
          sub={
            pool.oldestSoldAt && pool.newestSoldAt
              ? `pool covers ${fmtDate(pool.oldestSoldAt)} onward`
              : "no dated range available"
          }
        />
      </div>

      <p className="text-xs text-ink-400">
        Every price on this page is the last asking price observed before the
        listing left the market. None of them is a confirmed negotiated sale
        price, and neither pool records what a buyer actually paid.
      </p>

      <SoldPriceDistribution
        prices={singles.map((row) => row.price_usd_equivalent ?? row.price)}
        poolLabel={meta.noun}
        groupLotsExcluded={groupLotsInSlice}
        newestSoldAt={pool.newestSoldAt}
      />

      <SoldByMaturity
        rows={rows.map((row) => ({
          maturity: row.maturity,
          sold_at: row.sold_at,
        }))}
        poolLabel={meta.noun}
      />

      <section className="space-y-2">
        <p className="text-xs text-ink-400">
          The cumulative chart below counts captured sold events only: the{" "}
          {fmtInt(captured.total)} status transitions the pipeline recorded, all
          of them in May. The {fmtInt(inferred.total)} inferred records are not
          in that series. The days-to-sell histogram uses the pool selected
          above, and only the rows where time on market could be measured.
        </p>
        <ChartGrid page="sold" ctx={{ soldRows: rows, soldActivity }} />
      </section>

      <section>
        <h2 className="mb-3 font-display text-[20px] font-medium tracking-tight text-ink-50">
          {meta.title}, most recent first
        </h2>
        <SortableSoldTable
          rows={rows}
          poolTotal={pool.total}
          poolLabel={meta.noun}
        />
      </section>

      <SourceFootnote
        sources={[
          "MorphMarket",
          "v_sold_reconciled (captured events and inferred disappearances)",
        ]}
        n={rows.length}
        methodologyAnchor="days-to-sell"
      />
    </div>
  );
}

function PoolCard({
  pool,
  selected,
  onSelect,
}: {
  pool: SoldPool;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = POOL_META[pool.basis];
  const measurable = pool.measurableDays?.length ?? null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-lg border p-4 text-left transition ${
        selected
          ? "border-claude-glow/60 bg-claude/10"
          : "border-ink-700 bg-ink-800 hover:border-ink-600"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[16px] font-medium text-ink-50">
          {meta.title}
        </span>
        <span className="font-mono text-[15px] tabular-nums text-ink-100">
          {fmtInt(pool.total)}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-300">{meta.definition}</p>
      <dl className="mt-3 space-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
        <div className="flex justify-between gap-3">
          <dt>Covers</dt>
          <dd className="text-ink-300">
            {pool.oldestSoldAt && pool.newestSoldAt
              ? `${fmtDate(pool.oldestSoldAt)} to ${fmtDate(pool.newestSoldAt)}`
              : "no dated rows"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Time on market measurable</dt>
          <dd className="text-ink-300">
            {measurable == null
              ? "unavailable"
              : `${fmtInt(measurable)} of ${fmtInt(pool.total)} rows`}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Group lots</dt>
          <dd className="text-ink-300">
            {pool.groupLots == null ? "unavailable" : fmtInt(pool.groupLots)}
          </dd>
        </div>
      </dl>
    </button>
  );
}

function SearchParamsSync({
  onChange,
}: {
  onChange: (filters: SoldFilterState) => void;
}) {
  const searchParams = useSearchParams();
  const morph = searchParams.get("morph") ?? undefined;
  const maturity = searchParams.get("maturity") ?? undefined;
  const sex = searchParams.get("sex") ?? undefined;

  useEffect(() => {
    onChange({ morph, maturity, sex });
  }, [maturity, morph, onChange, sex]);

  return null;
}

function median(values: (number | null | undefined)[]): number | null {
  const clean = values
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
    .sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0
    ? (clean[mid - 1] + clean[mid]) / 2
    : clean[mid];
}

// Mirror of newestIso from lib/format, for the far end of the covered
// window. Kept local because only this page needs the oldest stamp.
function oldestIso(...candidates: Array<string | null>): string | null {
  let best: string | null = null;
  let bestT = Infinity;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const t = Date.parse(candidate);
    if (Number.isFinite(t) && t < bestT) {
      bestT = t;
      best = candidate;
    }
  }
  return best;
}
