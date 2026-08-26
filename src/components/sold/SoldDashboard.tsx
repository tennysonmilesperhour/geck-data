"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ChartGrid from "@/components/charts/ChartGrid";
import KpiCard from "@/components/ui/KpiCard";
import { SectionHeader } from "@/components/ui/Panel";
import DataFreshness from "@/components/ui/DataFreshness";
import { fmtInt, fmtUsd } from "@/lib/format";
import SoldPriceDistribution from "./SoldPriceDistribution";
import SoldByMaturity from "./SoldByMaturity";
import SoldFilters from "./SoldFilters";
import SortableSoldTable, { type SoldRow } from "./SortableSoldTable";
import SourceFootnote from "@/components/ui/SourceFootnote";
import {
  applySoldFilters,
  type SoldFilters as SoldFilterState,
} from "@/lib/sold/filters";
import type { SoldActivityWeek } from "@/lib/sold/activity";

export default function SoldDashboard({
  allRows,
  soldActivity,
  generatedAt,
}: {
  allRows: SoldRow[];
  soldActivity: SoldActivityWeek[];
  generatedAt: string;
}) {
  const [filters, setFilters] = useState<SoldFilterState>({});
  const { morph, maturity, sex } = filters;

  const rows = useMemo(
    () => applySoldFilters(allRows, { morph, maturity, sex }),
    [allRows, maturity, morph, sex],
  );
  const filtered = allRows.length !== rows.length;

  const days = rows
    .map((row) => row.days_to_sell)
    .filter((day): day is number => typeof day === "number" && day >= 0);
  const medianPrice = median(
    rows.map((row) => row.price_usd_equivalent ?? row.price),
  );
  const generatedAtMs = Date.parse(generatedAt);
  const sevenDayCount = rows.filter(
    (row) =>
      row.sold_at &&
      generatedAtMs - Date.parse(row.sold_at) < 7 * 86_400_000,
  ).length;
  const inferredCount = rows.filter(
    (row) => row.sold_source === "extension_inferred",
  ).length;
  const filterSummary = [morph, maturity, sex].filter(Boolean).join(" · ");

  return (
    <div className="page-rise space-y-8">
      <Suspense fallback={null}>
        <SearchParamsSync onChange={setFilters} />
      </Suspense>

      <SectionHeader
        eyebrow="Outcomes / Comps"
        title="Sold"
        description={
          filtered
            ? `Showing ${fmtInt(rows.length)} of ${fmtInt(allRows.length)} recent sold listings narrowed by ${filterSummary}. The histogram, cohort multiples, and table all reflect this slice.`
            : "Listings that have flipped from live to sold — either explicitly captured by the extension or inferred from absence. Narrow the slice with the filter below."
        }
        right={
          <DataFreshness
            updatedAt={allRows[0]?.sold_at ?? null}
            window="all time"
          />
        }
      />

      <SoldFilters current={filters} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={filtered ? "Sold (matching filter)" : "Sold (all time)"}
          value={fmtInt(rows.length)}
        />
        <KpiCard
          label="Sold past 7 days"
          value={fmtInt(sevenDayCount)}
          tone="positive"
        />
        <KpiCard
          label="Median time-to-sell"
          value={days.length ? `${Math.round(median(days) ?? 0)} d` : "—"}
        />
        <KpiCard label="Median sold price" value={fmtUsd(medianPrice)} />
      </div>

      {rows.length >= 5 ? (
        <SoldPriceDistribution
          prices={rows.map((row) => row.price_usd_equivalent ?? row.price)}
        />
      ) : filtered ? (
        <section className="surface p-5">
          <p className="text-sm text-ink-400">
            Only {fmtInt(rows.length)} sold listings match this slice — too few
            to draw a distribution. Try widening the filter.
          </p>
        </section>
      ) : null}

      <SoldByMaturity
        rows={rows.map((row) => ({
          maturity: row.maturity,
          sold_at: row.sold_at,
        }))}
      />

      <ChartGrid page="sold" ctx={{ soldRows: rows, soldActivity }} />

      {inferredCount > 0 ? (
        <p className="text-xs text-ink-400">
          {fmtInt(inferredCount)} sold events inferred from absence (14d rule).
        </p>
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-[20px] font-medium tracking-tight text-ink-50">
          Recently sold
        </h2>
        <SortableSoldTable rows={rows} />
      </section>

      <SourceFootnote
        sources={[
          "MorphMarket",
          "Eye in the Sky extension",
          "scraper-inferred sold",
        ]}
        n={rows.length}
        methodologyAnchor="days-to-sell"
      />
    </div>
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
