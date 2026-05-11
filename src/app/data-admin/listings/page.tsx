// Listings browser. Server-rendered, 50 per page, sortable by last_seen_at
// desc by default. Click a row to expand the JSON snapshot.

import Link from "next/link";
import { getListings } from "@/lib/geck-data/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function formatPrice(value: number | null, currency: string | null): string {
  if (value === null) return "-";
  const sym = currency === "USD" ? "$" : currency ?? "";
  return `${sym}${Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const { rows, total } = await getListings(page, PAGE_SIZE);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wide text-ink-300">
          Listings ({total.toLocaleString()})
        </h2>
        <Pager page={page} lastPage={lastPage} />
      </div>

      <div className="overflow-x-auto rounded-md border border-ink-700 bg-ink-850">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2">image</th>
              <th className="px-3 py-2">name</th>
              <th className="px-3 py-2">price</th>
              <th className="px-3 py-2">sex</th>
              <th className="px-3 py-2">weight</th>
              <th className="px-3 py-2">traits</th>
              <th className="px-3 py-2">seller</th>
              <th className="px-3 py-2">first seen</th>
              <th className="px-3 py-2">last seen</th>
              <th className="px-3 py-2">live?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.listing_id} className="border-t border-ink-800">
                <td className="px-3 py-2">
                  {r.primary_image_url ? (
                    <div className="relative h-12 w-12 overflow-hidden rounded bg-ink-900">
                      {/* Using <img> instead of next/image to avoid configuring
                          every possible image host. Thumbnails are small. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.primary_image_url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="h-12 w-12 rounded bg-ink-900" />
                  )}
                </td>
                <td className="max-w-[28ch] px-3 py-2">
                  <Link
                    href={r.listing_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-100 hover:underline"
                  >
                    {r.name ?? r.listing_id}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-200">
                  {formatPrice(r.price, r.currency)}
                </td>
                <td className="px-3 py-2 text-ink-300">{r.sex ?? "-"}</td>
                <td className="px-3 py-2 text-ink-300">
                  {r.weight ?? (r.weight_grams ? `${r.weight_grams}g` : "-")}
                </td>
                <td className="max-w-[36ch] px-3 py-2 text-ink-300">
                  {(r.trait_array ?? []).slice(0, 4).join(", ") || "-"}
                  {(r.trait_array?.length ?? 0) > 4 && " ..."}
                </td>
                <td className="max-w-[18ch] px-3 py-2 text-ink-300">
                  {r.seller_name ?? "-"}
                </td>
                <td className="px-3 py-2 text-ink-400">
                  {formatDate(r.first_seen_at)}
                </td>
                <td className="px-3 py-2 text-ink-400">
                  {formatDate(r.last_seen_at)}
                </td>
                <td className="px-3 py-2">
                  {r.is_active ? (
                    <span className="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200">
                      live
                    </span>
                  ) : (
                    <span className="rounded border border-ink-700 bg-ink-900/40 px-2 py-0.5 text-xs text-ink-300">
                      gone
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-ink-400">
                  No listings yet. Once the daily scrape runs (or the CSV
                  migration lands) this table fills in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} lastPage={lastPage} />
    </div>
  );
}

function Pager({ page, lastPage }: { page: number; lastPage: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <PagerLink page={page - 1} disabled={page <= 1} label="< prev" />
      <span className="text-ink-400">
        page {page} / {lastPage}
      </span>
      <PagerLink
        page={page + 1}
        disabled={page >= lastPage}
        label="next >"
      />
    </div>
  );
}

function PagerLink({
  page,
  disabled,
  label,
}: {
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="rounded border border-ink-800 bg-ink-900 px-2 py-1 text-ink-500">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={`/data-admin/listings?page=${page}`}
      className="rounded border border-ink-700 bg-ink-850 px-2 py-1 text-ink-200 hover:border-ink-600"
    >
      {label}
    </Link>
  );
}
