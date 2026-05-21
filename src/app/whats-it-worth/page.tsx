"use client";
// What's it worth? — the public-facing estimator for crested gecko price.
//
// Single-input flow:
//   1. Pick a combo (chips) — covers the 12 canonical combos we track.
//   2. (Optional) Refine: age, sex, weight, proven status.
//   3. Result: adjusted price band + base band + recent comparable sales.
//
// Calls /api/market/fair-price (POST with traits + attributes). The same
// endpoint powers the inline morph-card estimate on Geck Inspect, so this
// page IS the canonical experience — Geck Inspect just splices the
// `adjusted` field into its morph badge.
//
// Designed for a hobbyist: no jargon, no setup, results in one screen.
import { useEffect, useState } from "react";
import { HIGH_VALUE_COMBOS } from "@/lib/market/combos";

type ApiResponse = {
  combo_id: string;
  matched?: { id: string; name: string; display: string } | null;
  n: number;
  base: { p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null } | null;
  adjusted: { p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null } | null;
  applied?: Record<string, number> | null;
  multiplier_total?: number;
  confidence: "low" | "medium" | "high";
  note: string;
  recent_sales?: Array<{
    listing_id: string;
    sold_usd: number | null;
    sold_at: string;
    days_to_sell: number | null;
    seller_name: string | null;
    source_url: string | null;
  }>;
  message?: string;
};

const AGES = [
  { v: "hatchling", label: "Hatchling" },
  { v: "juvenile", label: "Juvenile" },
  { v: "subadult", label: "Subadult" },
  { v: "adult", label: "Adult" },
  { v: "proven_breeder", label: "Proven breeder" },
] as const;

const SEXES = [
  { v: "female", label: "Female" },
  { v: "male", label: "Male" },
  { v: "unknown", label: "Not sure" },
] as const;

export default function WhatsItWorthPage() {
  const [comboId, setComboId] = useState<string>("");
  const [age, setAge] = useState<string>("subadult");
  const [sex, setSex] = useState<string>("unknown");
  const [weight, setWeight] = useState<string>("");
  const [proven, setProven] = useState<boolean>(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!comboId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({
          combo: comboId,
          age,
          sex,
          proven: String(proven),
          recent_sales: "5",
        });
        if (weight) params.set("weight", weight);
        const r = await fetch(`/api/market/fair-price?${params.toString()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as ApiResponse;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [comboId, age, sex, weight, proven]);

  return (
    <div className="market-theme space-y-8">
      <header>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-forest-400">
          Estimate
        </div>
        <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-forest-50">
          What&apos;s it worth?
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-forest-300">
          Crested gecko price estimate from recent MorphMarket sales. Pick a
          combo, refine for age and sex, and we&apos;ll show you the band most
          listings sell in plus a few recent comparable sales.
        </p>
      </header>

      <section>
        <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-forest-400">
          1. Combo
        </h2>
        <div className="flex flex-wrap gap-2">
          {HIGH_VALUE_COMBOS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setComboId(c.id)}
              className={
                "rounded-full border px-3 py-1.5 text-sm transition " +
                (comboId === c.id
                  ? "border-ready/60 bg-ready/10 text-ready"
                  : "border-forest-700 bg-forest-950/60 text-forest-200 hover:border-forest-500")
              }
            >
              {c.display}
            </button>
          ))}
        </div>
      </section>

      {comboId && (
        <section>
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-forest-400">
            2. Refine (optional)
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Field label="Age">
              <select
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full rounded-md border border-forest-700 bg-forest-950 px-3 py-2 text-sm text-forest-100 focus:border-ready focus:outline-none"
              >
                {AGES.map((a) => (
                  <option key={a.v} value={a.v}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sex">
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value)}
                className="w-full rounded-md border border-forest-700 bg-forest-950 px-3 py-2 text-sm text-forest-100 focus:border-ready focus:outline-none"
              >
                {SEXES.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Weight (grams)">
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="e.g. 45"
                className="w-full rounded-md border border-forest-700 bg-forest-950 px-3 py-2 text-sm text-forest-100 focus:border-ready focus:outline-none"
              />
            </Field>
            <Field label="Proven breeder">
              <label className="flex items-center gap-2 text-sm text-forest-200">
                <input
                  type="checkbox"
                  checked={proven}
                  onChange={(e) => setProven(e.target.checked)}
                  className="h-4 w-4"
                />
                Confirmed offspring
              </label>
            </Field>
          </div>
        </section>
      )}

      {comboId && (
        <section>
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-forest-400">
            3. Estimate
          </h2>
          {loading && <p className="text-sm text-forest-400">…calculating</p>}
          {error && <p className="text-sm text-red-400">unavailable: {error}</p>}
          {data && <Result data={data} />}
        </section>
      )}

      <footer className="border-t border-forest-700/60 pt-4 text-xs text-forest-500">
        Got a photo? <a href="https://geck-inspect.vercel.app" className="underline hover:text-ready">Recognize a gecko from a photo with Geck Inspect</a>{" "}
        — the same estimate appears under every morph it identifies.
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-forest-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function Result({ data }: { data: ApiResponse }) {
  if (data.message && !data.adjusted) {
    return (
      <div className="rounded-lg border border-forest-700 bg-forest-950/60 p-4 text-sm text-forest-300">
        {data.message}
      </div>
    );
  }
  const adj = data.adjusted;
  if (!adj) return null;

  const p50 = adj.p50 ?? 0;
  const p25 = adj.p25 ?? 0;
  const p75 = adj.p75 ?? 0;
  const p10 = adj.p10 ?? 0;
  const p90 = adj.p90 ?? 0;

  return (
    <div className="space-y-4">
      <div className="forest-surface p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-forest-400">
              Typical sold price
            </div>
            <div className="font-display text-4xl font-medium text-forest-50">
              ${p25.toLocaleString()}–${p75.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-forest-400">
              Midpoint ≈ ${p50.toLocaleString()} · range ${p10.toLocaleString()}–${p90.toLocaleString()}
            </div>
          </div>
          <ConfidenceTag confidence={data.confidence} n={data.n} />
        </div>
        <PriceBar p10={p10} p25={p25} p50={p50} p75={p75} p90={p90} />
        <p className="mt-3 text-[11px] text-forest-500">{data.note}</p>
      </div>

      {data.applied && (
        <details className="rounded-lg border border-forest-700/60 bg-forest-950/40 p-3 text-xs text-forest-300">
          <summary className="cursor-pointer text-forest-200">How we adjusted</summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(data.applied).map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span className="text-forest-400">{k}</span>
                <span className="font-mono">×{v.toFixed(2)}</span>
              </li>
            ))}
            {data.multiplier_total != null && (
              <li className="flex justify-between border-t border-forest-700/40 pt-1 font-medium">
                <span>Combined</span>
                <span className="font-mono">×{data.multiplier_total.toFixed(2)}</span>
              </li>
            )}
          </ul>
        </details>
      )}

      {data.recent_sales && data.recent_sales.length > 0 && (
        <div className="forest-surface p-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-forest-400">
            Recent comparable sales
          </div>
          <ul className="divide-y divide-forest-700/40">
            {data.recent_sales.map((s) => (
              <li key={s.listing_id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono text-forest-100">
                  ${s.sold_usd ? Math.round(s.sold_usd).toLocaleString() : "—"}
                </span>
                <span className="text-xs text-forest-400">
                  {new Date(s.sold_at).toLocaleDateString()}
                </span>
                <span className="text-xs text-forest-400">
                  {s.days_to_sell != null ? `${s.days_to_sell}d to sell` : ""}
                </span>
                <span className="text-xs text-forest-500">
                  {s.seller_name ?? ""}
                </span>
                {s.source_url && (
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-ready hover:underline"
                  >
                    source ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConfidenceTag({
  confidence,
  n,
}: {
  confidence: "low" | "medium" | "high";
  n: number;
}) {
  const map = {
    high: { label: "High confidence", tone: "text-ready border-ready/40 bg-ready/10" },
    medium: { label: "Medium confidence", tone: "text-forest-200 border-forest-600 bg-forest-900/40" },
    low: { label: "Low confidence", tone: "text-warn border-warn/40 bg-warn/10" },
  } as const;
  const c = map[confidence];
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${c.tone}`}
      title={`Based on ${n} comparable sales`}
    >
      {c.label} · n={n}
    </span>
  );
}

function PriceBar({
  p10,
  p25,
  p50,
  p75,
  p90,
}: {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}) {
  // The visual: a horizontal axis from p10 to p90 with markers at p25/p50/p75.
  // Bar fills the IQR (p25..p75) so the eye is drawn to the "typical" range.
  if (p90 <= p10) return null;
  const pct = (v: number) => ((v - p10) / (p90 - p10)) * 100;
  return (
    <div className="mt-4">
      <div className="relative h-6 rounded-full bg-forest-950 ring-1 ring-inset ring-forest-700">
        <div
          className="absolute top-0 h-full rounded-full bg-ready/30"
          style={{ left: `${pct(p25)}%`, width: `${pct(p75) - pct(p25)}%` }}
        />
        <div
          className="absolute top-0 h-full w-px bg-ready"
          style={{ left: `${pct(p50)}%` }}
          title={`Midpoint $${p50}`}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-forest-500">
        <span>${p10.toLocaleString()}</span>
        <span>${p50.toLocaleString()}</span>
        <span>${p90.toLocaleString()}</span>
      </div>
    </div>
  );
}
