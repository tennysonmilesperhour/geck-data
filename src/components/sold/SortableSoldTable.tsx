"use client";
// Client wrapper around <DataTable /> that adds sticky-header column
// sort. Lifted out of /sold/page.tsx so the server can keep doing the
// data fetch and the sort state can live on the client.
//
// Column UX: header rows show an arrow when the active sort key
// matches; clicking flips direction. Unsortable columns render plain.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import DataTable, { type Column } from "@/components/ui/DataTable";
import CsvDownloadButton from "@/components/ui/CsvDownloadButton";
import { fmtDate, fmtInt, fmtRelative, fmtUsd } from "@/lib/format";
import WatchButton from "@/components/alerts/WatchButton";

// Drop trailing maturity/sex/price-y debris from the title so the
// "Watch" alert is named for the morph itself, not "Lilly White
// Pinstripe Male Juvenile $400".
const STRIP_TOKENS = /\b(male|female|unsexed|juv(?:enile)?|sub(?:adult)?|adult|babies?|hatchling|breeder|pair|trio)\b/gi;
function morphTermFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const cleaned = title
    .replace(STRIP_TOKENS, " ")
    .replace(/\$[\d,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned.length < 3) return null;
  return cleaned;
}

// The two sold pools v_sold_reconciled keeps apart. captured_event is a
// transition the pipeline watched happen; inferred_unseen is a listing the
// catalogue walk stopped seeing, so a sale is inferred from its absence.
// They are never summed into one number anywhere on this page.
export type SoldBasis = "captured_event" | "inferred_unseen";

export type SoldRow = {
  id: string;
  seller_id: string | null;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  maturity: string | null;
  sex: string | null;
  first_seen_at: string | null;
  sold_at: string | null;
  days_to_sell: number | null;
  sold_source: string | null;
  // Optional so the narrower row shapes built elsewhere (filter fixtures,
  // callers that only need the identity columns) still satisfy the type.
  // Rows coming from v_sold_reconciled always carry both.
  sold_basis?: SoldBasis | null;
  is_group_lot?: boolean | null;
};

const BASIS_BADGE: Record<SoldBasis, { label: string; title: string }> = {
  captured_event: {
    label: "Captured",
    title: "The pipeline observed this listing flip to sold.",
  },
  inferred_unseen: {
    label: "Inferred",
    title:
      "The catalogue walk stopped seeing this listing, so the sale is inferred from its absence.",
  },
};

// Rows the table paints. Sorting reorders the loaded set first, so this is
// a display cap, not a claim about how deep the pool goes.
const VISIBLE_ROWS = 200;

type SortKey = "price" | "days" | "sold_at";
type SortDir = "asc" | "desc";

function priceOf(r: SoldRow): number {
  return r.price_usd_equivalent ?? r.price ?? 0;
}

function cmp(a: SoldRow, b: SoldRow, key: SortKey): number {
  switch (key) {
    case "price":
      return priceOf(a) - priceOf(b);
    case "days":
      return (a.days_to_sell ?? Number.POSITIVE_INFINITY) -
        (b.days_to_sell ?? Number.POSITIVE_INFINITY);
    case "sold_at": {
      const at = a.sold_at ? Date.parse(a.sold_at) : 0;
      const bt = b.sold_at ? Date.parse(b.sold_at) : 0;
      return at - bt;
    }
  }
}

export default function SortableSoldTable({
  rows,
  poolTotal,
  poolLabel,
}: {
  rows: SoldRow[];
  /** True size of the pool these rows were drawn from, for the footnote. */
  poolTotal?: number | null;
  /** How to name that pool in the footnote, e.g. "inferred sold records". */
  poolLabel?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("sold_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column: prices and days low->high
      // means "cheapest first / fastest first" which is most useful;
      // sold_at descending = newest first.
      setSortDir(key === "sold_at" ? "desc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => (sortDir === "asc" ? cmp(a, b, sortKey) : cmp(b, a, sortKey)));
    return arr;
  }, [rows, sortKey, sortDir]);

  function headerFor(key: SortKey, label: string) {
    const active = key === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggle(key)}
        className={`inline-flex items-center gap-1 ${
          active ? "text-ink-100" : "text-ink-400 hover:text-ink-200"
        }`}
      >
        {label}
        <span
          aria-hidden
          className={`text-[8px] ${active ? "opacity-100" : "opacity-30"}`}
        >
          {active ? (sortDir === "asc" ? "▲" : "▼") : "▲▼"}
        </span>
      </button>
    );
  }

  const columns: Column<SoldRow>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <div>
          <div className="font-medium text-ink-100">
            {r.title ?? r.id}
            {r.is_group_lot ? (
              <span
                className="ml-2 rounded border border-busy/50 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-busy"
                title="One price covering several animals, so it is not a per-animal comp."
              >
                Group lot
              </span>
            ) : null}
          </div>
          <div className="text-xs text-ink-400">{r.id}</div>
        </div>
      ),
    },
    {
      key: "maturity",
      header: "Maturity",
      render: (r) => r.maturity ?? "Unreported",
    },
    { key: "sex", header: "Sex", render: (r) => r.sex ?? "Unreported" },
    {
      key: "price",
      header: headerFor("price", "Last ask"),
      align: "right",
      render: (r) => {
        const ask = r.price_usd_equivalent ?? r.price;
        return ask == null ? (
          <span className="text-ink-500">unpriced</span>
        ) : (
          fmtUsd(ask)
        );
      },
    },
    {
      key: "days",
      header: headerFor("days", "Days"),
      align: "right",
      // A null here is not a zero. It means first-seen and sold landed in the
      // same import, so no time on market can be measured for this row.
      render: (r) =>
        r.days_to_sell == null ? (
          <span
            className="text-ink-500"
            title="First seen and sold were stamped in the same import, so time on market cannot be measured."
          >
            not measurable
          </span>
        ) : (
          fmtInt(r.days_to_sell)
        ),
    },
    {
      key: "sold_at",
      header: headerFor("sold_at", "Sold"),
      render: (r) =>
        r.sold_at ? (
          <span title={fmtDate(r.sold_at)}>{fmtRelative(r.sold_at)}</span>
        ) : (
          <span className="text-ink-500">undated</span>
        ),
    },
    {
      key: "seller",
      header: "Seller",
      render: (r) =>
        r.seller_id ? (
          <Link
            href={`/sellers/${r.seller_id}`}
            className="text-claude hover:underline"
          >
            {r.seller_id}
          </Link>
        ) : (
          "Unreported"
        ),
    },
    {
      key: "basis",
      header: "Basis",
      render: (r) => {
        const badge = r.sold_basis ? BASIS_BADGE[r.sold_basis] : null;
        return (
          <div>
            <span
              className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-200"
              title={badge?.title}
            >
              {badge?.label ?? "Unlabelled"}
            </span>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-500">
              {r.sold_source ?? "source unrecorded"}
            </div>
          </div>
        );
      },
    },
    {
      key: "watch",
      header: "Watch",
      align: "right",
      render: (r) => {
        const term = morphTermFromTitle(r.title);
        if (!term) return null;
        return (
          <Suspense fallback={null}>
            <WatchButton
              label="Watch"
              alertName={`Morph: ${term.slice(0, 60)}`}
              query={{ kind: "morph", term }}
            />
          </Suspense>
        );
      },
    },
  ];

  const exportRows = useMemo(
    () =>
      sorted.map((r) => ({
        listing_id: r.id,
        title: r.title,
        seller_id: r.seller_id,
        price_usd: r.price_usd_equivalent ?? r.price,
        maturity: r.maturity,
        sex: r.sex,
        first_seen_at: r.first_seen_at,
        sold_at: r.sold_at,
        days_to_sell: r.days_to_sell,
        sold_basis: r.sold_basis,
        sold_source: r.sold_source,
        is_group_lot: r.is_group_lot,
      })),
    [sorted],
  );

  const shown = Math.min(VISIBLE_ROWS, sorted.length);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <CsvDownloadButton
          rows={exportRows}
          filename={`sold-${new Date().toISOString().slice(0, 10)}.csv`}
          label="Download CSV"
        />
      </div>
      <DataTable
        columns={columns}
        rows={sorted.slice(0, VISIBLE_ROWS)}
        rowKey={(r) => r.id}
        emptyMessage="No sold records in this slice."
      />
      {sorted.length > 0 ? (
        <p className="text-xs text-ink-500">
          {`Showing ${fmtInt(shown)} of ${fmtInt(sorted.length)} loaded rows${
            poolTotal != null && poolTotal > sorted.length
              ? `, drawn from ${fmtInt(poolTotal)} ${poolLabel ?? "rows"} in this pool`
              : ""
          }. Sorting reorders the loaded rows first, so it changes which ${fmtInt(VISIBLE_ROWS)} appear here. The CSV covers all ${fmtInt(sorted.length)} loaded rows.`}
        </p>
      ) : null}
    </div>
  );
}
