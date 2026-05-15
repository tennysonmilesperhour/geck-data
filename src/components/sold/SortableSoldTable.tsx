"use client";
// Client wrapper around <DataTable /> that adds sticky-header column
// sort. Lifted out of /sold/page.tsx so the server can keep doing the
// data fetch and the sort state can live on the client.
//
// Column UX: header rows show an arrow when the active sort key
// matches; clicking flips direction. Unsortable columns render plain.

import { useMemo, useState } from "react";
import Link from "next/link";
import DataTable, { type Column } from "@/components/ui/DataTable";
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
};

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

export default function SortableSoldTable({ rows }: { rows: SoldRow[] }) {
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
          <div className="font-medium text-ink-100">{r.title ?? r.id}</div>
          <div className="text-xs text-ink-400">{r.id}</div>
        </div>
      ),
    },
    { key: "maturity", header: "Maturity", render: (r) => r.maturity ?? "—" },
    { key: "sex", header: "Sex", render: (r) => r.sex ?? "—" },
    {
      key: "price",
      header: headerFor("price", "Price"),
      align: "right",
      render: (r) => fmtUsd(r.price_usd_equivalent ?? r.price),
    },
    {
      key: "days",
      header: headerFor("days", "Days"),
      align: "right",
      render: (r) => fmtInt(r.days_to_sell),
    },
    {
      key: "sold_at",
      header: headerFor("sold_at", "Sold"),
      render: (r) => (
        <span title={fmtDate(r.sold_at)}>{fmtRelative(r.sold_at)}</span>
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
          "—"
        ),
    },
    {
      key: "source",
      header: "Source",
      render: (r) => (
        <span className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-200">
          {r.sold_source ?? "—"}
        </span>
      ),
    },
    {
      key: "watch",
      header: "Watch",
      align: "right",
      render: (r) => {
        const term = morphTermFromTitle(r.title);
        if (!term) return null;
        return (
          <WatchButton
            label="Watch"
            alertName={`Morph: ${term.slice(0, 60)}`}
            query={{ kind: "morph", term }}
          />
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={sorted.slice(0, 200)}
      rowKey={(r) => r.id}
      emptyMessage="No sold listings recorded yet."
    />
  );
}
