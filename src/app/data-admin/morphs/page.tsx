// Morph price breakdown. Reads the morph_price_stats view. Trait names
// come from listings.trait_array via LATERAL unnest, so this includes
// every individual trait seen on an active listing at least 3 times.

import { getMorphPriceStats } from "@/lib/geck-data/queries";

export const dynamic = "force-dynamic";

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "-";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function MorphsPage() {
  const rows = await getMorphPriceStats();
  return (
    <div className="space-y-4">
      <h2 className="text-sm uppercase tracking-wide text-ink-300">
        Morph breakdown ({rows.length})
      </h2>
      <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2">trait</th>
              <th className="px-3 py-2 text-right">listings</th>
              <th className="px-3 py-2 text-right">avg</th>
              <th className="px-3 py-2 text-right">median</th>
              <th className="px-3 py-2 text-right">p25</th>
              <th className="px-3 py-2 text-right">p75</th>
              <th className="px-3 py-2 text-right">min</th>
              <th className="px-3 py-2 text-right">max</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.trait_name} className="border-t border-ink-800">
                <td className="px-3 py-2 text-ink-100">{r.trait_name}</td>
                <td className="px-3 py-2 text-right text-ink-200">
                  {r.listing_count}
                </td>
                <td className="px-3 py-2 text-right text-ink-200">
                  {fmt(r.avg_price)}
                </td>
                <td className="px-3 py-2 text-right text-ink-200">
                  {fmt(r.median_price)}
                </td>
                <td className="px-3 py-2 text-right text-ink-300">
                  {fmt(r.p25_price)}
                </td>
                <td className="px-3 py-2 text-right text-ink-300">
                  {fmt(r.p75_price)}
                </td>
                <td className="px-3 py-2 text-right text-ink-400">
                  {fmt(r.min_price)}
                </td>
                <td className="px-3 py-2 text-right text-ink-400">
                  {fmt(r.max_price)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-ink-400">
                  No morph stats yet. The view requires at least 3 active
                  listings per trait.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
