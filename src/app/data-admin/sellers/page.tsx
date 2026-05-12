// Seller leaderboard. Reads the seller_stats view (precomputed in the DB)
// and ranks by active_listings desc.

import { getSellerStats } from "@/lib/geck-data/queries";

export const dynamic = "force-dynamic";

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "-";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export default async function SellersPage() {
  const rows = await getSellerStats();
  return (
    <div className="space-y-4">
      <h2 className="text-sm uppercase tracking-wide text-ink-300">
        Sellers ({rows.length})
      </h2>
      <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2">seller</th>
              <th className="px-3 py-2 text-right">active listings</th>
              <th className="px-3 py-2 text-right">avg price</th>
              <th className="px-3 py-2">first listing seen</th>
              <th className="px-3 py-2">last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seller_name} className="border-t border-ink-800">
                <td className="px-3 py-2 text-ink-100">{r.seller_name}</td>
                <td className="px-3 py-2 text-right text-ink-200">
                  {r.active_listings}
                </td>
                <td className="px-3 py-2 text-right text-ink-200">
                  {fmt(r.avg_price)}
                </td>
                <td className="px-3 py-2 text-ink-300">
                  {fmtDate(r.first_listing_seen)}
                </td>
                <td className="px-3 py-2 text-ink-300">
                  {fmtDate(r.last_active)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-400">
                  No seller stats yet. Run a listings scrape first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
