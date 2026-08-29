"use client";
// Filter chips for /sold. Each chip is a Next.js Link that adds or
// removes a query param on the URL; the server page re-renders with
// the filtered slice. Pure URL state, so it is shareable, bookmarkable
// and keyboard-navigable for free.
//
// The available morph set is intentionally bounded to the in-app
// glossary (one shipped sentence of explanation per morph). Picking
// from "every unique trait token in the dataset" would yield hundreds
// of noisy chips.

import Link from "next/link";
import { lookupMorph } from "@/lib/morphs/glossary";
import type { SoldFilters as SoldFilterState } from "@/lib/sold/filters";

// Baby was missing here while being the second most common age class in the
// sold pool (111 records against Adult's 130), so the largest young cohort
// simply had no chip. These four are every value the data actually carries.
const MATURITIES = ["Baby", "Juvenile", "Subadult", "Adult"] as const;
const SEXES = ["male", "female"] as const;

const FEATURED_MORPHS = [
  "Lilly White",
  "Harlequin",
  "Extreme Harlequin",
  "Pinstripe",
  "Reverse Pinstripe",
  "Axanthic",
  "Cappuccino",
  "Halloween",
  "Tiger",
  "Brindle",
  "Flame",
  "Phantom",
  "Dalmatian",
];

function buildHref(
  pathname: string,
  current: URLSearchParams,
  key: string,
  value: string | null,
): string {
  const next = new URLSearchParams(current.toString());
  if (value === null) {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition ${
        active
          ? "border-claude-glow/60 bg-claude/15 text-claude-glow"
          : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600 hover:text-ink-100"
      }`}
    >
      {children}
    </Link>
  );
}

export default function SoldFilters({
  current,
}: {
  current: SoldFilterState;
}) {
  const pathname = "/sold";
  const sp = new URLSearchParams();
  const { morph, maturity, sex } = current;
  if (morph) sp.set("morph", morph);
  if (maturity) sp.set("maturity", maturity);
  if (sex) sp.set("sex", sex);

  const activeCount = [morph, maturity, sex].filter(Boolean).length;

  return (
    <section className="surface p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-[16px] font-medium tracking-tight text-ink-100">
            Comps filter
          </h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Narrow the histogram, cohort multiples, and recently-sold table to
            a slice of the market. Filters live in the URL so any view is
            shareable.
          </p>
        </div>
        {activeCount > 0 ? (
          <Link
            href={pathname}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-claude hover:text-claude-glow"
          >
            Clear all
          </Link>
        ) : null}
      </header>

      <div className="space-y-3">
        <Row label="Morph">
          {FEATURED_MORPHS.map((m) => {
            const isActive = morph === m;
            const entry = lookupMorph(m);
            return (
              <Chip
                key={m}
                href={buildHref(pathname, sp, "morph", isActive ? null : m)}
                active={isActive}
              >
                <span title={entry?.description ?? undefined}>{m}</span>
              </Chip>
            );
          })}
        </Row>

        {/* Maturity is recorded on 395 of 2,932 sold records, so any chip here
            narrows to that 13% rather than to an age class within the whole
            pool. Said out loud, because a filter that silently drops seven
            eighths of the data reads as a filter that found nothing. */}
        <Row
          label="Maturity"
          note="recorded on about 13% of sold records; the rest are hidden by any choice here"
        >
          {MATURITIES.map((m) => {
            const isActive = maturity === m;
            return (
              <Chip
                key={m}
                href={buildHref(
                  pathname,
                  sp,
                  "maturity",
                  isActive ? null : m,
                )}
                active={isActive}
              >
                {m}
              </Chip>
            );
          })}
        </Row>

        <Row label="Sex">
          {SEXES.map((s) => {
            const isActive = sex === s;
            return (
              <Chip
                key={s}
                href={buildHref(pathname, sp, "sex", isActive ? null : s)}
                active={isActive}
              >
                {s}
              </Chip>
            );
          })}
        </Row>
      </div>
    </section>
  );
}

function Row({
  label,
  children,
  note,
}: {
  label: string;
  children: React.ReactNode;
  /** Coverage caveat for this filter, shown beside the chips. */
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-500">
        {label}
      </span>
      <div className="flex flex-wrap items-baseline gap-1.5">
        {children}
        {note ? (
          <span className="text-[10px] leading-4 text-ink-500">{note}</span>
        ) : null}
      </div>
    </div>
  );
}
