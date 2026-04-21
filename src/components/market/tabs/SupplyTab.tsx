"use client";
// Supply tab — forward-looking projected hatchlings over the next 9
// months. Reads v_supply_pipeline_monthly (aggregated by (month, combo))
// with fixture fallback so the shape of the product is visible even
// before any user records breeding data.
//
// The enterprise-lock banner stays because the UX promise ("Live
// internal sales, scraped external feeds, and forward-looking breeding
// signals activate with an Enterprise subscription") is the gate we'll
// wire to real paywalling later — the data visibility itself already
// respects RLS (owners see their pairs, admins see all).
import type { Filters } from "@/lib/market/types";
import { fetchSupplyPipeline } from "@/lib/market/queries";
import { useFilteredQuery } from "@/lib/market/useFilteredQuery";
import SupplyStackedBars from "@/components/market/widgets/SupplyStackedBars";
import SourceBadge from "@/components/market/SourceBadge";
import LivePreviewTag from "@/components/market/LivePreviewTag";

export default function SupplyTab({ filters }: { filters: Filters }) {
  const q = useFilteredQuery(fetchSupplyPipeline, filters, [] as const);

  if (!q.data) {
    return (
      <div className="forest-surface p-6 text-sm text-forest-400">
        Loading supply pipeline…
      </div>
    );
  }
  const data = q.data;

  return (
    <div className="space-y-4">
      <LockBanner />

      <section className="forest-surface p-5 opacity-95">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ready/10 text-ready ring-1 ring-inset ring-ready/30"
            >
              ⚘
            </span>
            <div>
              <h2 className="text-base font-semibold text-forest-50">
                Supply pipeline — projected hatchlings (9-month)
              </h2>
              <p className="mt-0.5 text-xs text-forest-400">
                Forward-looking supply from Geck Inspect users&apos; own breeding
                records — available nowhere else
              </p>
            </div>
          </div>
          <LivePreviewTag status={q.status} note={q.note} />
        </header>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Kpi label="Active pairs tracked" value={data.activePairs.toLocaleString()} unit="pairs" />
          <Kpi
            label="Projected 9M hatchlings"
            value={data.projectedNine.toLocaleString()}
            unit="juveniles"
          />
          <Kpi label="Peak month" value={data.peakMonth} unit="" />
        </div>

        <div className="mt-5">
          <SupplyStackedBars months={data.months} />
        </div>

        <footer className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-forest-500">
          <span className="font-mono">Source:</span>
          <SourceBadge id="gi_breeding" size="sm" />
          <span>— user-tracked pair outcomes, projected forward with base-rate clutch sizes.</span>
        </footer>
      </section>
    </div>
  );
}

function LockBanner() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-ready/30 bg-ready/5 px-4 py-3 text-sm shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ready/40 bg-ready/10 text-ready"
        >
          ⚿
        </span>
        <p className="max-w-2xl leading-5 text-forest-200">
          <span className="font-semibold text-ready">Viewing with preview data.</span>{" "}
          Live internal sales, scraped external feeds, and forward-looking
          breeding signals activate with an Enterprise subscription.
        </p>
      </div>
      <a
        href="#plans"
        className="inline-flex items-center gap-1 rounded-md bg-ready px-3 py-1.5 text-sm text-forest-975 hover:bg-ready/90"
      >
        View plans →
      </a>
    </div>
  );
}

function Kpi({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-lg border border-forest-700 bg-forest-950/40 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-forest-500">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-forest-50">
          {value}
        </span>
        {unit ? <span className="text-xs text-forest-400">{unit}</span> : null}
      </div>
    </div>
  );
}
