// Browse listings. Two views: what is listed now and what sold. Filters
// are a plain form that writes to the URL, so results can be shared and
// work without JavaScript.
import Link from "next/link";
import { getListings, getMorphs, traitsFromSlugs } from "@/lib/simple/data";
import { Empty, ListingGrid, PageIntro } from "@/components/simple/ui";
import { fmtInt } from "@/lib/format";

export const revalidate = 900;

export const metadata = {
  title: "Crested gecko listings - Geck Inspect",
  description: "Browse crested gecko listings and recent sales by morph, sex and price.",
};

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const PAGE_SIZE = 24;

export default async function ListingsPage({ searchParams }: { searchParams?: SearchParams }) {
  const status = one(searchParams?.status) === "sold" ? "sold" : "for-sale";
  const sexRaw = one(searchParams?.sex);
  const sex = sexRaw === "male" || sexRaw === "female" ? sexRaw : null;
  const ageRaw = one(searchParams?.age);
  const age = ["hatchling", "juvenile", "subadult", "adult"].includes(ageRaw) ? ageRaw : null;
  const maxRaw = Number(one(searchParams?.max));
  const maxPrice = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.round(maxRaw) : null;
  const sortRaw = one(searchParams?.sort);
  const sort = sortRaw === "price-low" || sortRaw === "price-high" ? sortRaw : "newest";
  const page = Math.max(1, Math.min(200, Number(one(searchParams?.page)) || 1));
  const tRaw = one(searchParams?.t);
  const sellerRaw = one(searchParams?.seller);
  const seller = /^[A-Za-z0-9_.-]{1,80}$/.test(sellerRaw) ? sellerRaw : null;

  const morphs = await getMorphs();
  const selected = traitsFromSlugs(
    morphs,
    tRaw.split(",").map((s) => s.trim()).filter(Boolean),
  );
  const tValue = selected.map((m) => m.slug).join(",");

  const { rows, total } = await getListings({
    traits: selected.map((m) => m.trait),
    status,
    sex,
    age,
    maxPrice,
    sort,
    seller,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const params = (over: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | number | null> = {
      status: status === "sold" ? "sold" : null,
      t: tValue || null,
      sex,
      age,
      max: maxPrice,
      sort: sort === "newest" ? null : sort,
      seller,
      page: null,
      ...over,
    };
    for (const [k, v] of Object.entries(base)) if (v != null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `/listings?${s}` : "/listings";
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const inputCls =
    "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-claude focus:outline-none";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageIntro title="Listings">
        Crested geckos listed on MorphMarket, and the ones that sold. Tap any gecko to
        open the original listing.
      </PageIntro>

      <div className="flex gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1 text-sm sm:w-fit">
        {(
          [
            ["for-sale", "Listed now"],
            ["sold", "Sold"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={params({ status: value === "sold" ? "sold" : null })}
            className={`flex-1 rounded-md px-4 py-2 text-center transition sm:flex-none ${
              status === value ? "bg-ink-700 text-ink-50" : "text-ink-400 hover:text-ink-100"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <form
        method="get"
        action="/listings"
        className="grid grid-cols-2 gap-3 rounded-xl border border-ink-700 bg-ink-850 p-4 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] md:items-end"
      >
        {status === "sold" ? <input type="hidden" name="status" value="sold" /> : null}
        {seller ? <input type="hidden" name="seller" value={seller} /> : null}
        <label className="col-span-2 space-y-1 md:col-span-1">
          <span className="text-sm text-ink-400">Morph</span>
          <select name="t" defaultValue={tValue} className={inputCls}>
            <option value="">Any morph</option>
            {selected.length > 1 ? (
              <option value={tValue}>{selected.map((m) => m.trait).join(" + ")}</option>
            ) : null}
            {morphs.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.trait}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Sex</span>
          <select name="sex" defaultValue={sex ?? ""} className={inputCls}>
            <option value="">Any</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Age</span>
          <select name="age" defaultValue={age ?? ""} className={inputCls}>
            <option value="">Any</option>
            <option value="hatchling">Hatchling</option>
            <option value="juvenile">Juvenile</option>
            <option value="subadult">Subadult</option>
            <option value="adult">Adult</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Max price</span>
          <input
            name="max"
            type="number"
            min={0}
            step={25}
            inputMode="numeric"
            placeholder="No limit"
            defaultValue={maxPrice ?? ""}
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm text-ink-400">Sort</span>
          <select name="sort" defaultValue={sort} className={inputCls}>
            <option value="newest">{status === "sold" ? "Most recent" : "Newest"}</option>
            <option value="price-low">Price, low to high</option>
            <option value="price-high">Price, high to low</option>
          </select>
        </label>
        <button
          type="submit"
          className="col-span-2 rounded-lg bg-claude px-5 py-2 text-sm font-medium text-ink-950 hover:bg-claude-glow md:col-span-1"
        >
          Show
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-400">
        <span>
          {fmtInt(total)} {status === "sold" ? "sold" : "listed"}
          {selected.length ? ` with ${selected.map((m) => m.trait).join(" + ")}` : ""}
          {seller ? ` from ${rows[0]?.sellerName ?? seller}` : ""}
        </span>
        {selected.length || sex || age || maxPrice || seller ? (
          <Link href={params({ t: null, sex: null, age: null, max: null, seller: null })} className="hover:text-ink-100">
            Clear filters
          </Link>
        ) : null}
      </div>

      {rows.length ? (
        <ListingGrid listings={rows} />
      ) : (
        <Empty>No geckos match these filters. Try a higher price or a different morph.</Empty>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={params({ page: page - 1 })} className="rounded-lg border border-ink-700 px-4 py-2 text-ink-200 hover:border-ink-500">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-400">
            Page {page} of {fmtInt(Math.min(pages, 200))}
          </span>
          {page < pages && page < 200 ? (
            <Link href={params({ page: page + 1 })} className="rounded-lg border border-ink-700 px-4 py-2 text-ink-200 hover:border-ink-500">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      {status === "sold" ? (
        <p className="text-sm text-ink-500">
          Sold prices are the last asking price seen before a listing came down, not a
          confirmed payment. Sales history covers spring 2026.
        </p>
      ) : null}
    </div>
  );
}
