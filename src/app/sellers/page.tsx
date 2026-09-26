// Breeders: who lists crested geckos, how many, at what typical price and
// which morphs they focus on. Search by name or place; each card opens the
// breeder's page.
import Link from "next/link";
import { getBreeders } from "@/lib/simple/data";
import { Avatar, Empty, PageIntro } from "@/components/simple/ui";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 1800;

export const metadata = {
  title: "Crested gecko breeders - Geck Inspect",
  description: "Crested gecko breeders on MorphMarket, what they list and at what prices.",
};

type SearchParams = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 30;

export default async function BreedersPage({ searchParams }: { searchParams?: SearchParams }) {
  const qRaw = searchParams?.q;
  const q = (Array.isArray(qRaw) ? qRaw[0] : qRaw ?? "").trim().slice(0, 60);
  const pageRaw = searchParams?.page;
  const page = Math.max(1, Number(Array.isArray(pageRaw) ? pageRaw[0] : pageRaw) || 1);

  const all = await getBreeders();
  const needle = q.toLowerCase();
  const matches = needle
    ? all.filter(
        (b) =>
          b.name.toLowerCase().includes(needle) ||
          (b.location ?? "").toLowerCase().includes(needle) ||
          b.topTraits.some((t) => t.toLowerCase().includes(needle)),
      )
    : all.filter((b) => b.forSale > 0 || b.sold > 0);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const shown = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const href = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (p > 1) s.set("page", String(p));
    const str = s.toString();
    return str ? `/sellers?${str}` : "/sellers";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageIntro title="Breeders">
        Breeders selling crested geckos on MorphMarket, sorted by how many they have
        listed.
      </PageIntro>

      <form method="get" action="/sellers" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name, place or morph"
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-ink-100 focus:border-claude focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-claude px-5 py-2 text-sm font-medium text-ink-950 hover:bg-claude-glow"
        >
          Search
        </button>
      </form>

      <div className="text-sm text-ink-400">
        {fmtInt(matches.length)} breeders{q ? ` matching "${q}"` : ""}
      </div>

      {shown.length ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((b) => (
            <li key={b.slug}>
              <Link
                href={`/sellers/${b.slug}`}
                className="flex h-full gap-4 rounded-xl border border-ink-700 bg-ink-850 p-4 transition hover:border-ink-500"
              >
                <Avatar name={b.name} src={b.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink-50">{b.name}</div>
                  <div className="truncate text-sm text-ink-400">
                    {b.location ?? "Location not listed"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-300">
                    <span>
                      <span className="tabular-nums text-ink-100">{fmtInt(b.forSale)}</span> listed
                    </span>
                    {b.askMid != null ? (
                      <span>
                        typical <span className="tabular-nums text-ink-100">{fmtUsd(b.askMid)}</span>
                      </span>
                    ) : null}
                    {b.sold ? (
                      <span>
                        <span className="tabular-nums text-ink-100">{fmtInt(b.sold)}</span> sold
                      </span>
                    ) : null}
                  </div>
                  {b.topTraits.length ? (
                    <div className="mt-2 text-xs text-ink-500">
                      Mostly {b.topTraits.join(", ")}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No breeders match that search.</Empty>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={href(page - 1)} className="rounded-lg border border-ink-700 px-4 py-2 text-ink-200 hover:border-ink-500">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-400">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="rounded-lg border border-ink-700 px-4 py-2 text-ink-200 hover:border-ink-500">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
