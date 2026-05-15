// Visual block: two-column trait premium vs market baseline. The
// computation lives in src/lib/market/trait-premium.ts so other
// surfaces can reuse the same shaped data.
//
// Adopted by /compare to replace the inline implementation; can drop
// onto /trends or combo-detail pages once they accumulate enough
// per-trait priced observations.
import { fmtPct, fmtUsd } from "@/lib/format";
import type { TraitPremium } from "@/lib/market/trait-premium";
import { Panel } from "@/components/ui/Panel";

export default function TraitPremiumPanel({
  rows,
  limit = 10,
  title = "Trait premium vs market",
  subtitle = "Positive means listings carrying the trait price above the market median. Minimum 5 priced observations per trait.",
}: {
  rows: ReadonlyArray<TraitPremium>;
  limit?: number;
  title?: string;
  subtitle?: string;
}) {
  if (rows.length === 0) {
    return (
      <Panel title={title} subtitle={subtitle}>
        <p className="text-sm text-ink-400">
          Not enough trait-level priced observations yet — at least 5 per
          trait is required.
        </p>
      </Panel>
    );
  }

  const top = [...rows].sort((a, b) => b.premium - a.premium).slice(0, limit);
  const bottom = [...rows].sort((a, b) => a.premium - b.premium).slice(0, limit);

  const premiumMax = Math.max(1, ...top.map((t) => Math.abs(t.premium)));
  const discountMax = Math.max(1, ...bottom.map((t) => Math.abs(t.premium)));

  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Column
          eyebrow="Premium traits"
          eyebrowTone="text-ready"
          rows={top}
          barMax={premiumMax}
          barColor="bg-ready"
          numTone="text-ready"
        />
        <Column
          eyebrow="Discount traits"
          eyebrowTone="text-danger"
          rows={bottom}
          barMax={discountMax}
          barColor="bg-danger"
          numTone="text-danger"
        />
      </div>
    </Panel>
  );
}

function Column({
  eyebrow,
  eyebrowTone,
  rows,
  barMax,
  barColor,
  numTone,
}: {
  eyebrow: string;
  eyebrowTone: string;
  rows: ReadonlyArray<TraitPremium>;
  barMax: number;
  barColor: string;
  numTone: string;
}) {
  return (
    <div>
      <div className={`mb-2 font-mono text-[10px] uppercase tracking-[0.16em] ${eyebrowTone}`}>
        {eyebrow}
      </div>
      <ul className="space-y-1.5">
        {rows.map((t) => {
          const w = Math.round((Math.abs(t.premium) / barMax) * 100);
          return (
            <li
              key={t.trait}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm"
              title={t.description ?? undefined}
            >
              <span className="truncate text-ink-100">{t.displayName}</span>
              <div className="h-1.5 w-32 rounded bg-ink-700/80 md:w-40">
                <div
                  className={`h-1.5 rounded ${barColor}`}
                  style={{ width: `${w}%` }}
                />
              </div>
              <span className="w-28 text-right font-mono text-[12px]">
                <span className={numTone}>{fmtPct(t.premium, 0)}</span>
                <span className="ml-2 text-ink-500">· {fmtUsd(t.median)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
