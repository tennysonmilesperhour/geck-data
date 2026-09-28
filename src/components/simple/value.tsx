// Value report pieces: the age x sex grid and the trait upgrade list.
//
// The grid borrows from livestock auction reports and collector price
// guides (Hagerty's condition grades, PriceCharting's loose/boxed/graded
// columns): one row per stage of growth, one column per sex, so the reader
// sees at a glance how a gecko's value changes as it grows and once it is
// sexed. Every cell links to itself, so the grid doubles as the picker.
import Link from "next/link";
import { fmtInt, fmtUsd } from "@/lib/format";
import {
  AGE_CLASSES,
  AGE_LABEL,
  MIN_CELL,
  SEX_CLASSES,
  SEX_LABEL,
  gridKey,
  type AgeClass,
  type SexClass,
  type ValueGrid,
} from "@/lib/simple/estimate";
import type { Upgrade } from "@/lib/simple/data";

export function ValueGridTable({
  grid,
  age,
  sex,
  hrefFor,
}: {
  grid: ValueGrid;
  age: AgeClass | null;
  sex: SexClass | null;
  hrefFor: (age: AgeClass, sex: SexClass) => string;
}) {
  // Cells are tinted by price, darkest to brightest, so the grid reads as a
  // heat map before any number is read.
  const mids = AGE_CLASSES.flatMap((a) =>
    SEX_CLASSES.map((s) => grid.get(gridKey(a, s))).filter(
      (c): c is NonNullable<typeof c> => !!c && c.n >= MIN_CELL && c.p50 != null,
    ),
  ).map((c) => c.p50 as number);
  const lo = mids.length ? Math.min(...mids) : 0;
  const hi = mids.length ? Math.max(...mids) : 1;
  const tint = (v: number) => 0.04 + (hi > lo ? (v - lo) / (hi - lo) : 0.5) * 0.2;
  return (
    <div className="overflow-x-auto">
      <table className="plain w-full min-w-[520px] border-collapse border border-ink-700 text-left">
        <caption className="sr-only">
          Typical asking price by age and sex. Each cell shows the middle price, the
          range of the middle half, and how many listings it is based on.
        </caption>
        <thead>
          <tr className="border-b border-ink-700">
            <th className="w-28 px-3 py-2 text-xs font-normal text-ink-500" scope="col">
              <span className="sr-only">Age</span>
            </th>
            {SEX_CLASSES.map((s) => (
              <th
                key={s}
                scope="col"
                className="border-l border-ink-700 px-3 py-2 text-xs font-medium uppercase tracking-wider text-ink-400"
              >
                {SEX_LABEL[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {AGE_CLASSES.map((a) => (
            <tr key={a} className="border-t border-ink-700">
              <th scope="row" className="px-3 text-sm font-medium text-ink-300">
                {AGE_LABEL[a]}
              </th>
              {SEX_CLASSES.map((s) => {
                const c = grid.get(gridKey(a, s));
                const enough = !!c && c.n >= MIN_CELL && c.p50 != null;
                const selected = a === age && s === sex;
                return (
                  <td key={s} className="border-l border-ink-700 p-0 align-top">
                    <Link
                      href={hrefFor(a, s)}
                      scroll={false}
                      aria-current={selected ? "true" : undefined}
                      className={`block h-full px-3 py-2.5 transition hover:bg-ink-750 ${
                        selected ? "shadow-[inset_0_0_0_1.5px_rgb(var(--claude-glow))]" : ""
                      }`}
                      style={enough ? { background: `rgb(var(--claude) / ${selected ? 0.3 : tint(c!.p50!)})` } : undefined}
                    >
                      {enough ? (
                        <>
                          <div className="text-lg font-semibold tabular-nums text-ink-50">
                            {fmtUsd(c!.p50)}
                          </div>
                          <div className="text-xs tabular-nums text-ink-300">
                            {fmtUsd(c!.p25)} to {fmtUsd(c!.p75)}
                          </div>
                          <div className="text-[11px] tabular-nums text-ink-500">{fmtInt(c!.n)} listings</div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm text-ink-500">Too few</div>
                          <div className="text-[11px] text-ink-500">
                            {c ? `${fmtInt(c.n)} listing${c.n === 1 ? "" : "s"}` : "none"}
                          </div>
                        </>
                      )}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What adding one more trait does to the typical asking price, the way a
 * car pricing guide shows what each option adds. Each row adds that trait
 * to the price check.
 */
export function UpgradeList({
  upgrades,
  hrefFor,
  limit = 8,
}: {
  upgrades: Upgrade[];
  hrefFor: (trait: string) => string | null;
  limit?: number;
}) {
  const rows = upgrades
    .filter((u) => u.p50 > u.baseP50 * 1.05)
    .slice(0, limit);
  if (!rows.length) return null;
  // Bars show what the trait adds, on one shared scale.
  const maxLift = Math.max(...rows.map((u) => u.p50 - u.baseP50));
  return (
    <ul className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
      {rows.map((u) => {
        const lift = u.p50 - u.baseP50;
        const href = hrefFor(u.trait);
        const inner = (
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[180px_1fr_auto]">
            <div className="font-medium text-ink-100">+ {u.trait}</div>
            <div className="text-right text-sm tabular-nums text-ink-200 sm:order-last">
              {fmtUsd(u.p50)}{" "}
              <span className="text-claude-glow">+{fmtUsd(u.p50 - u.baseP50)}</span>
            </div>
            <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
              <div className="h-1 flex-1 bg-ink-800">
                <div className="bar-fill h-full" style={{ width: `${Math.max((lift / maxLift) * 100, 2)}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right text-[11px] text-ink-500">
                {fmtInt(u.n)} listings
              </span>
            </div>
          </div>
        );
        return (
          <li key={u.trait}>
            {href ? (
              <Link href={href} scroll={false} className="block transition hover:bg-ink-750">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
