// Breeder cards and profile pieces. The pricing and focus lines sit on
// the card itself, because buyers judge sellers on what they can see
// without clicking through.
import Link from "next/link";
import { fmtInt, fmtUsd } from "@/lib/format";
import type { Breeder } from "@/lib/simple/data";
import {
  activeSince,
  focus,
  pricing,
  pricingPhrase,
  stagePhrase,
} from "@/lib/simple/breeders";
import Avatar from "./Avatar";
import { seriesColor } from "@/components/charts/series";

const PRICING_CLS = {
  below: "bg-claude/15 text-claude-glow",
  at: "bg-ink-700 text-ink-200",
  above: "bg-ink-700 text-ink-300",
} as const;

export function PricingPill({ b }: { b: Breeder }) {
  const p = pricing(b);
  const phrase = pricingPhrase(b);
  if (!p || !phrase) return null;
  return <span className={`rounded-sm px-1.5 py-0.5 text-xs ${PRICING_CLS[p]}`}>{phrase}</span>;
}

export function BreederCard({ b }: { b: Breeder }) {
  const since = activeSince(b);
  const stageLine = stagePhrase(b);
  const f = focus(b).slice(0, 3);
  return (
    <Link
      href={`/sellers/${b.slug}`}
      className="flex h-full flex-col gap-3 rounded-xl border border-ink-700 bg-ink-850 p-4 transition hover:border-ink-500"
    >
      <div className="flex gap-3">
        <Avatar name={b.name} src={b.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink-50">{b.name}</div>
          <div className="truncate text-sm text-ink-400">
            {[b.location, since ? `seen since ${since}` : null].filter(Boolean).join(" · ") ||
              "Location not listed"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-300">
        <span>
          <span className="tabular-nums text-ink-100">{fmtInt(b.forSale)}</span> listed
        </span>
        {b.sold ? (
          <span>
            <span className="tabular-nums text-ink-100">{fmtInt(b.sold)}</span> sold
          </span>
        ) : null}
        {b.askMid != null ? (
          <span>
            typical <span className="tabular-nums text-ink-100">{fmtUsd(b.askMid)}</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <PricingPill b={b} />
        {stageLine ? (
          <span className="rounded-sm bg-ink-800 px-1.5 py-0.5 text-xs text-ink-300">{stageLine}</span>
        ) : null}
      </div>

      {f.length ? (
        <div className="mt-auto space-y-1.5">
          {f.map((x) => (
            <div key={x.trait} className="grid grid-cols-[110px_1fr_auto] items-center gap-2 text-xs">
              <span className="truncate text-ink-300">{x.trait}</span>
              <span className="h-1 overflow-hidden bg-ink-800">
                <span className="bar-fill block h-full" style={{ width: `${Math.max(x.share * 100, 4)}%` }} />
              </span>
              <span className="tabular-nums text-ink-500">{Math.round(x.share * 100)}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

/**
 * How a breeder's prices spread across the lowest quarter, middle half and
 * top quarter of similar geckos. A breeder pricing like the market would
 * land about 25 / 50 / 25, which the page states next to it.
 */
export function PricingSplit({ b }: { b: Breeder }) {
  const total = b.nLow + b.nTypical + b.nHigh;
  if (total < 5) return null;
  const parts = [
    // One ordered scale from the series gradient: low is brightest.
    { key: "low", label: "Low for its kind", n: b.nLow, color: seriesColor(0, 3) },
    { key: "typical", label: "Typical price", n: b.nTypical, color: seriesColor(1, 3) },
    { key: "high", label: "High for its kind", n: b.nHigh, color: seriesColor(2, 3) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden" role="img" aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
        {parts.map((p) =>
          p.n ? (
            <span key={p.key} className="h-full border-r-2 border-ink-850 last:border-r-0" style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
          ) : null,
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {parts.map((p) => (
          <div key={p.key}>
            <div className="flex items-center gap-1.5 text-ink-300">
              <span className="h-2 w-2 rounded-[1px]" style={{ background: p.color }} />
              {p.label}
            </div>
            <div className="tabular-nums text-ink-50">
              {Math.round((p.n / total) * 100)}%{" "}
              <span className="text-xs text-ink-500">({fmtInt(p.n)})</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-500">
        Each listing is compared with similar geckos: same strongest morph, age and sex.
        A breeder pricing like everyone else would land near 25%, 50% and 25%.
      </p>
    </div>
  );
}
