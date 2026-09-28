// Small, plain building blocks for the simplified site. The goal is one
// visual language: readable sentence-case labels, roomy cards, one accent
// color, and numbers that always say what they are.
import Link from "next/link";
import ListingImage from "@/components/media/ListingImage";
import { fmtUsd } from "@/lib/format";
import type { Listing, PriceBand } from "@/lib/simple/data";

export function PageIntro({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
          {title}
        </h1>
        {children ? (
          <div className="mt-3 text-base leading-7 text-ink-300">{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-ink-50">{title}</h2>
          {note ? <p className="mt-1 text-sm text-ink-400">{note}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-ink-700 bg-ink-850 p-5 shadow-edge ${className}`}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-5 py-4">
      <div className="text-sm text-ink-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink-50">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </div>
  );
}

export function TextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-sm font-medium text-claude-glow hover:underline">
      {children}
    </Link>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "quiet";
}) {
  const cls =
    variant === "primary"
      ? "bg-claude text-white hover:bg-claude-soft"
      : "border border-ink-600 text-ink-100 hover:border-ink-500 hover:bg-ink-800";
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition ${cls}`}
    >
      {children}
    </Link>
  );
}

/** A toggle chip rendered as a link, so filters live in the URL. */
export function Chip({
  href,
  active = false,
  children,
  title,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      scroll={false}
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[13px] transition ${
        active
          ? "border-claude bg-claude/15 text-ink-50"
          : "border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-500 hover:text-ink-100"
      }`}
    >
      {children}
    </Link>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 px-5 py-8 text-center text-sm text-ink-400">
      {children}
    </div>
  );
}

export function fmtShortDate(s: string | null | undefined): string {
  if (!s) return "unknown date";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return "unknown date";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtMonthRange(from: string | null, to: string | null): string {
  const f = (s: string) =>
    new Date(s).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  if (!from && !to) return "unknown dates";
  if (!from || !to) return f((from ?? to) as string);
  const a = f(from);
  const b = f(to);
  return a === b ? a : `${a} to ${b}`;
}

/**
 * Horizontal price range. The hairline spans the 10th to 90th percentile,
 * the bar the middle half (25th to 75th), and the tick the median.
 * `scaleMax` lets several bars share one axis so they can be compared.
 */
export function PriceRangeBar({
  band,
  scaleMax,
}: {
  band: Pick<PriceBand, "p10" | "p25" | "p50" | "p75" | "p90">;
  scaleMax: number;
}) {
  const pct = (v: number | null) =>
    v == null ? null : Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const lo = pct(band.p10 ?? band.p25);
  const hi = pct(band.p90 ?? band.p75);
  const q1 = pct(band.p25);
  const q3 = pct(band.p75);
  const mid = pct(band.p50);
  return (
    <div className="relative h-6" aria-hidden="true">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700" />
      {lo != null && hi != null ? (
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-ink-500"
          style={{ left: `${lo}%`, width: `${Math.max(hi - lo, 0.5)}%` }}
        />
      ) : null}
      {q1 != null && q3 != null ? (
        <div
          className="bar-fill absolute top-1/2 h-1.5 -translate-y-1/2"
          style={{ left: `${q1}%`, width: `${Math.max(q3 - q1, 1)}%` }}
        />
      ) : null}
      {mid != null ? (
        <div
          className="absolute top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-ink-50"
          style={{ left: `${mid}%` }}
        />
      ) : null}
    </div>
  );
}

export function PriceScale({ max }: { max: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  return (
    <div className="relative mt-1 h-4 text-[11px] tabular-nums text-ink-500">
      {ticks.map((t, i) => (
        <span
          key={t}
          className="absolute -translate-x-1/2"
          style={{ left: `${i * 25}%` }}
        >
          {i === 0 ? "$0" : fmtUsd(t)}
        </span>
      ))}
    </div>
  );
}

/** Round a price up to a friendly axis maximum. */
export function niceMax(v: number): number {
  const steps = [200, 400, 600, 800, 1000, 1500, 2000, 3000, 5000, 10000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 5000) * 5000;
}

const sexLabel = (s: string | null) => {
  const v = (s ?? "").toLowerCase();
  if (v === "male") return "Male";
  if (v === "female") return "Female";
  return null;
};

const POSITION: Record<"low" | "typical" | "high", { label: string; cls: string }> = {
  low: { label: "Low for its kind", cls: "bg-claude/15 text-claude-glow" },
  typical: { label: "Typical price", cls: "bg-ink-700 text-ink-200" },
  high: { label: "High for its kind", cls: "bg-ink-700 text-ink-300" },
};

/**
 * Where a price sits among similar geckos: same strongest morph, age and
 * sex. A marker on a small bar shows the price against the middle half of
 * similar listings, the way a price guide shows a range with your item on
 * it. Uses words, not just color.
 */
export function PricePosition({ listing }: { listing: Listing }) {
  if (!listing.position || listing.similarLow == null || listing.similarHigh == null || listing.price == null) {
    return null;
  }
  const lo = listing.similarLow;
  const hi = listing.similarHigh;
  const span = Math.max(hi - lo, 1);
  const min = Math.max(0, lo - span);
  const max = hi + span;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const p = POSITION[listing.position];
  const who = listing.comparedTrait ?? "crested geckos";
  return (
    <div className="space-y-1 pt-1">
      <div className="relative h-2" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 bg-ink-600"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-claude-glow"
          style={{ left: `${pct(listing.price)}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={`rounded-sm px-1.5 py-0.5 ${p.cls}`}>{p.label}</span>
        <span className="truncate text-ink-500" title={`Middle half of ${listing.comparedN ?? ""} similar ${who} listings`}>
          similar {fmtUsd(lo)} to {fmtUsd(hi)}
        </span>
      </div>
    </div>
  );
}

export function ListingCard({ listing }: { listing: Listing }) {
  const sold = Boolean(listing.soldAt);
  const maturity = listing.maturity === "Baby" ? "Hatchling" : listing.maturity;
  const weight = listing.weight ? `${Math.round(listing.weight)}g` : null;
  const details = [sexLabel(listing.sex), maturity, weight].filter(Boolean).join(", ");
  const inner = (
    <>
      <ListingImage
        src={listing.image}
        alt={listing.name ?? "Crested gecko"}
        className="aspect-square w-full rounded-t-xl border-0"
        sizes="(max-width: 640px) 50vw, 240px"
      />
      <div className="space-y-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold tabular-nums text-ink-50">
            {listing.price != null
              ? `${fmtUsd(listing.price)}${listing.currency && listing.currency !== "USD" ? ` ${listing.currency}` : ""}`
              : "No price"}
          </span>
          {sold ? (
            <span className="rounded-sm bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-200">Sold</span>
          ) : null}
        </div>
        <div className="line-clamp-1 text-sm text-ink-200">
          {listing.traits.length
            ? [
                ...(listing.comparedTrait && listing.traits.includes(listing.comparedTrait) ? [listing.comparedTrait] : []),
                ...listing.traits.filter((t) => t !== listing.comparedTrait),
              ]
                .slice(0, 3)
                .join(", ")
            : listing.name ?? "Crested gecko"}
        </div>
        <div className="line-clamp-1 text-xs text-ink-400">
          {[details, listing.sellerName].filter(Boolean).join(" · ")}
        </div>
        <div className="text-xs text-ink-500">
          {sold
            ? `Came down ${fmtShortDate(listing.soldAt)}`
            : `Last checked ${fmtShortDate(listing.lastSeenAt)}`}
        </div>
        <PricePosition listing={listing} />
      </div>
    </>
  );
  return (
    <Link
      href={`/listings/${encodeURIComponent(listing.id)}`}
      className="group block overflow-hidden rounded-xl border border-ink-700 bg-ink-850 transition hover:border-ink-500"
    >
      {inner}
    </Link>
  );
}

export function ListingGrid({ listings }: { listings: Listing[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} />
      ))}
    </div>
  );
}

export { default as Avatar } from "./Avatar";
