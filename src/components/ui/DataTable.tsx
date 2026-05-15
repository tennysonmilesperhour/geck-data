// Zero-JS data table for server-rendered analytics views. No sorting /
// pagination yet — consumers pre-sort and slice upstream. Render cells via
// render() so the caller controls formatting (links, monospace, etc.).
import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string; // e.g. "120px"
};

export default function DataTable<T>({
  columns,
  rows,
  emptyMessage = "No rows.",
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
  rowKey: (row: T, idx: number) => string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ink-700 bg-ink-850 p-6 text-center text-sm text-ink-400">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-800 shadow-panel">
      <table className="min-w-full divide-y divide-ink-700 text-sm">
        <thead className="bg-ink-850 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-3 py-2.5 font-medium ${
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                }`}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700/70 text-ink-200">
          {rows.map((row, idx) => (
            <tr key={rowKey(row, idx)} className="row-hover">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2.5 align-top ${
                    c.align === "right"
                      ? "text-right tabular-nums"
                      : c.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
