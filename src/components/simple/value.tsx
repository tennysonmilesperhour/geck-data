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
  return (
    <div className="overflow-x-auto">
      <table className="plain w-full min-w-[520px] border-separate border-spacing-1.5 text-left">
        <caption className="sr-only">
          Typical asking price by age and sex. Each cell shows the middle price, the
          range of the middle half, and how many listings it is based on.
        </caption>
        <thead>
          <tr>
            <th className="w-28 px-2 text-sm font-normal text-ink-400" scope="col">
              <span className="sr-only">Age</span>
            </th>
            {SEX_CLASSES.map((s) => (
              <th key={s} scope="col" className="px-3 pb-1 text-sm font-medium text-ink-300">
                {SEX_LABEL[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {AGE_CLASSES.map((a) => (
            <tr key={a}>
              <th scope="row" className="px-2 text-sm font-medium text-ink-300">
                {AGE_LABEL[a]}
              </th>
              {SEX_CLASSES.map((s) => {
                const c = grid.get(gridKey(a, s));
                const enough = !!c && c.n >= MIN_CELL && c.p50 != null;
                const selected = a === age && s === sex;
                return (
                  <td key={s} className="p-0 align-top">
                    <Link
                      href={hrefFor(a, s)}
                      scroll={false}
                      aria-current={selected ? "true" : undefined}
                      className={`block h-full rounded-lg border px-3 py-2.5 transition ${
                        selected
                          ? "border-claude bg-claude/15"
                          : enough
                            ? "border-ink-700 bg-ink-900 hover:border-ink-500"
                            : "border-dashed border-ink-700 bg-transparent hover:border-ink-500"
                      }`}
                    >
                      {enough ? (
                        <>
                          <div className="text-lg font-semibold tabular-nums text-ink-50">
                            {fmtUsd(c!.p50)}
                          </div>
                          <div className="text-xs tabular-nums text-ink-400">
                            {fmtUsd(c!.p25)} to {fmtUsd(c!.p75)}
                          </div>
                          <div className="text-[11px] text-ink-500">{fmtInt(c!.n)} listings</div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm text-ink-500">Too few</div>
                          <div className="text-[11px] text-ink-600">
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
  const maxRatio = Math.max(...rows.map((u) => u.p50 / u.baseP50));
  return (
    <ul className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
      {rows.map((u) => {
        const ratio = u.p50 / u.baseP50;
        const href = hrefFor(u.trait);
        const inner = (
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[180px_1fr_auto]">
            <div className="font-medium text-ink-100">+ {u.trait}</div>
            <div className="text-right text-sm tabular-nums text-ink-200 sm:order-last">
              {fmtUsd(u.p50)}{" "}
              <span className="text-claude-glow">+{fmtUsd(u.p50 - u.baseP50)}</span>
            </div>
            <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-claude/70"
                  style={{ width: `${Math.max((ratio / maxRatio) * 100, 4)}%` }}
                />
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
              <Link href={href} scroll={false} className="block transition hover:bg-ink-800">
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
