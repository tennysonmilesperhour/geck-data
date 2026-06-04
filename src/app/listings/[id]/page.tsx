// Public listing detail page. The URL pattern `/listings/<id>` is what the
// alert notifier puts in webhook payloads, so it has to resolve to something
// useful — until now the link 404'd.
//
// What we show:
//   - Listing title, price, currency, sex/weight/maturity
//   - First image (if any) from listing_images
//   - Price history line chart from price_history (last 180d)
//   - Status timeline (live/sold/removed events from listing_status_events)
//
// Server-rendered. Public read on every backing table.
import Image from "next/image";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import MiniSparkline from "@/components/charts/MiniSparkline";

export const dynamic = "force-dynamic";

type ListingRow = {
  id: string;
  title: string | null;
  price: number | null;
  price_usd_equivalent: number | null;
  sex: string | null;
  weight: number | string | null;
  maturity: string | null;
  cached_traits: string | null;
  species: string | null;
  seller_id: string | null;
  seller_name: string | null;
  seller_location: string | null;
  url: string | null;
  current_status: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type PriceRow = {
  observed_at: string;
  price: number | null;
  price_usd_equivalent: number | null;
  currency: string | null;
};

type StatusRow = {
  status: string;
  observed_at: string;
  source: string | null;
  inference_confidence: number | null;
};

type ImageRow = {
  storage_bucket: string;
  storage_path: string | null;
  image_url: string | null;
};

async function fetchAll(id: string) {
  const admin = createAdminClient();
  const [listing, history, statuses, images] = await Promise.all([
    admin
      .from("market_listings")
      .select(
        "id, title, price, price_usd_equivalent, sex, weight, maturity, cached_traits, species, seller_id, seller_name, seller_location, url, current_status, first_seen_at, last_seen_at",
      )
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => data as ListingRow | null),
    admin
      .from("price_history")
      .select("observed_at, price, price_usd_equivalent, currency")
      .eq("listing_id", id)
      .order("observed_at", { ascending: true })
      .limit(500)
      .then(({ data }) => (data ?? []) as PriceRow[]),
    admin
      .from("listing_status_events")
      .select("status, observed_at, source, inference_confidence")
      .eq("listing_id", id)
      .order("observed_at", { ascending: true })
      .limit(100)
      .then(({ data }) => (data ?? []) as StatusRow[]),
    admin
      .from("listing_images")
      .select("storage_bucket, storage_path, image_url")
      .eq("listing_id", id)
      .limit(10)
      .then(({ data }) => (data ?? []) as ImageRow[]),
  ]);
  return { listing, history, statuses, images };
}

function publicImageUrl(img: ImageRow): string | null {
  if (img.image_url) return img.image_url;
  if (img.storage_bucket === "listing-images" && img.storage_path) {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    if (base) return `${base}/storage/v1/object/public/${img.storage_bucket}/${img.storage_path}`;
  }
  return null;
}

export default async function ListingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { listing, history, statuses, images } = await fetchAll(params.id);

  if (!listing) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl">Listing not found</h1>
        <p className="text-ink-400">
          We don&apos;t have <code className="font-mono">{params.id}</code> in our
          observation log. It may have predated our scraping window or been
          archived.
        </p>
        <Link href="/" className="text-claude underline">
          Back to Pulse
        </Link>
      </div>
    );
  }

  const priceSeries = history
    .map((h) => h.price_usd_equivalent ?? h.price)
    .filter((v): v is number => v != null);
  const firstImg = images.find(publicImageUrl);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
            {listing.species ?? "unknown"} · {listing.current_status ?? "—"}
          </div>
          <h1 className="font-display text-2xl text-ink-50">
            {listing.title ?? listing.id}
          </h1>
          {listing.cached_traits && (
            <p className="mt-1 text-sm text-ink-300">{listing.cached_traits}</p>
          )}
          <p className="mt-2 text-xs text-ink-500">
            {listing.seller_name ? `${listing.seller_name} · ` : ""}
            {listing.seller_location ?? ""}
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl text-ink-50">
            {listing.price_usd_equivalent != null
              ? `$${Math.round(listing.price_usd_equivalent).toLocaleString()}`
              : listing.price
                ? `${listing.price}`
                : "—"}
          </div>
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-claude underline"
            >
              View on source ↗
            </a>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="md:col-span-1">
          {firstImg && publicImageUrl(firstImg) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={publicImageUrl(firstImg)!}
              alt={listing.title ?? ""}
              className="w-full rounded-lg border border-ink-700"
            />
          ) : (
            <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-6 text-center text-xs text-ink-500">
              no image stored
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Field label="Sex" value={listing.sex} />
            <Field label="Maturity" value={listing.maturity} />
            <Field label="Weight" value={listing.weight != null ? String(listing.weight) : null} />
            <Field label="First seen" value={fmtDate(listing.first_seen_at)} />
            <Field label="Last seen" value={fmtDate(listing.last_seen_at)} />
          </dl>
        </section>

        <section className="md:col-span-2 space-y-4">
          <div className="rounded-lg border border-ink-700 bg-ink-900/40 p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
              Price history ({history.length} samples)
            </div>
            {priceSeries.length > 0 ? (
              <MiniSparkline values={priceSeries} width={520} height={120} />
            ) : (
              <div className="py-6 text-center text-xs text-ink-500">no price observations</div>
            )}
          </div>

          <div className="rounded-lg border border-ink-700 bg-ink-900/40">
            <div className="border-b border-ink-700 p-3 font-mono text-[10px] uppercase tracking-wider text-ink-400">
              Status timeline
            </div>
            <ul className="divide-y divide-ink-800">
              {statuses.length === 0 ? (
                <li className="px-3 py-4 text-xs text-ink-500">no status events</li>
              ) : (
                statuses.map((s, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span
                      className={
                        "rounded px-2 py-0.5 font-mono " +
                        (s.status === "sold"
                          ? "bg-emerald-900/40 text-emerald-200"
                          : s.status === "removed"
                            ? "bg-ink-800 text-ink-400"
                            : "bg-ink-800 text-ink-200")
                      }
                    >
                      {s.status}
                    </span>
                    <span className="text-ink-400">{fmtDate(s.observed_at)}</span>
                    <span className="text-ink-500">{s.source ?? ""}</span>
                    <span className="text-ink-500">
                      conf{" "}
                      {s.inference_confidence != null
                        ? s.inference_confidence.toFixed(2)
                        : "—"}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-mono text-ink-200">{value ?? "—"}</dd>
    </>
  );
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}
