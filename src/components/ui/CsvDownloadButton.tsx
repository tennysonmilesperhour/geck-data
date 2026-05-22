"use client";
// Download-what-you-see CSV button. Takes a plain array of records and
// a filename; emits a browser download.
//
// Used on every data view that has a top-level table the spec calls
// out for export: sold, sellers, listings, indices, combo entity
// pages. Server data is already shaped client-friendly so a
// passing-the-rows approach keeps the button generic.
//
// Format conventions:
//   - Header row from object keys of the first record.
//   - String cells are JSON.stringify'd to handle commas and quotes
//     safely.
//   - Date cells (Date or ISO string) pass through unchanged.

import { useState } from "react";

export type CsvDownloadButtonProps<T extends Record<string, unknown>> = {
  rows: ReadonlyArray<T>;
  filename: string;
  /** Optional column order; defaults to Object.keys of first row. */
  columns?: ReadonlyArray<keyof T & string>;
  /** Optional row mapper (e.g. flatten nested attribution objects). */
  mapRow?: (row: T) => Record<string, unknown>;
  label?: string;
  className?: string;
};

function escape(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  // Always wrap strings in quotes to survive embedded commas, quotes,
  // newlines. Double-quote escaping per RFC 4180.
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<string>,
  mapRow?: (row: T) => Record<string, unknown>,
): string {
  const header = columns.map(escape).join(",");
  const body = rows
    .map((r) => {
      const mapped = mapRow ? mapRow(r) : r;
      return columns
        .map((c) => escape((mapped as Record<string, unknown>)[c]))
        .join(",");
    })
    .join("\n");
  return `${header}\n${body}`;
}

export default function CsvDownloadButton<T extends Record<string, unknown>>({
  rows,
  filename,
  columns,
  mapRow,
  label = "Download CSV",
  className = "",
}: CsvDownloadButtonProps<T>) {
  const [downloading, setDownloading] = useState(false);

  function handleClick() {
    if (rows.length === 0) return;
    setDownloading(true);
    try {
      const cols =
        columns && columns.length > 0
          ? Array.from(columns)
          : Object.keys(rows[0] as Record<string, unknown>);
      const csv = toCsv(rows, cols, mapRow);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the download starts cleanly.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={rows.length === 0 || downloading}
      title={
        rows.length === 0
          ? "Nothing to download"
          : `Download ${rows.length.toLocaleString()} rows as CSV`
      }
      className={
        "inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-50 " +
        className
      }
    >
      <span aria-hidden>↓</span>
      <span>{label}</span>
    </button>
  );
}
