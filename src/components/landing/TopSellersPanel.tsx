// Top sellers on the home page. Uses the same visual language as
// FeaturedSellerCard on /sellers (marketplace avatar when captured, initials
// fallback, recent-stock photography, emerald hover ring, three-stat row) so
// the same data object reads as the same product on both surfaces.
//
// The ranking metric is market_sellers.total_listings, which is a stock count
// frozen the last time that seller row was written, not a tally of what the
// seller has up today. Pangea's 269 was counted in May. So every card labels it
// as a catalogue and stamps the date it was counted, rather than presenting a
// spring number as this week's activity.
import Link from "next/link";
import { fmtUsd, fmtInt, fmtDate } from "@/lib/format";
import type { SellerCard } from "@/lib/landing/snapshot";
import SellerAvatar from "@/components/media/SellerAvatar";
import ListingImage from "@/components/media/ListingImage";

type Props = {
  sellers: SellerCard[];
};

export default function TopSellersPanel({ sellers }: Props) {
  return (
    <section className="surface-soft p-5">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay-300/80">
            Operators
          </div>
          <h2 className="mt-1 font-display text-[22px] font-medium tracking-tight text-ink-50">
            Largest catalogues
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Ranked by the listing count recorded on each seller&apos;s row, as of
            the date on the card. That is a catalogue size, not a measure of who
            is listing this week. Click a card for their listings, traits, and
            pricing history.
          </p>
        </div>
        <Link
          href="/sellers"
          className="text-xs text-ink-400 transition hover:text-claude-glow"
        >
          All sellers →
        </Link>
      </header>

      {sellers.length === 0 ? (
        <div className="rounded-md border border-ink-700/60 bg-ink-900/40 px-3 py-4 text-sm text-ink-400">
          No seller rows on record.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sellers.map((s) => (
            <li key={s.seller_id}>
              <Link
                href={`/sellers/${encodeURIComponent(s.seller_id)}`}
                className="surface-elevated hover-lift group flex h-full flex-col overflow-hidden"
              >
                {s.recent_listing_image_url ? (
                  <ListingImage
                    src={s.recent_listing_image_url}
                    alt={`Recent listing from ${s.seller_name ?? s.seller_id}`}
                    className="h-28 w-full border-x-0 border-t-0"
                    sizes="(min-width: 1024px) 28vw, (min-width: 640px) 44vw, 92vw"
                    label="Recent stock"
                    showFallback={false}
                  />
                ) : null}

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <SellerAvatar
                      name={s.seller_name ?? s.seller_id}
                      imageUrl={s.avatar_url}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[15px] font-medium leading-tight text-ink-50 transition group-hover:text-claude-glow">
                        {s.seller_name ?? s.seller_id}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-400">
                        {s.seller_location ?? "Location not reported"}
                      </div>
                    </div>
                    {s.membership ? (
                      <span className="inline-flex shrink-0 rounded-full border border-ink-700 bg-ink-850 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-400">
                        {s.membership}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-ink-700/60 pt-3">
                    <Stat
                      label="Catalogue"
                      value={
                        s.total_listings != null ? fmtInt(s.total_listings) : "n/a"
                      }
                    />
                    <Stat
                      label="Avg ask"
                      value={s.avg_price != null ? fmtUsd(s.avg_price) : "n/a"}
                    />
                    <Stat
                      label="Rating"
                      value={
                        s.five_star_rating != null
                          ? s.five_star_rating.toFixed(1)
                          : "n/a"
                      }
                    />
                  </div>

                  <div className="text-[11px] text-ink-500">
                    {s.catalogue_updated_at
                      ? `Counted ${fmtDate(s.catalogue_updated_at)}`
                      : "Count date not recorded"}
                  </div>

                  {s.morph_specialization ? (
                    <div className="text-xs text-ink-400">
                      <span className="text-ink-500">Focus · </span>
                      {s.morph_specialization}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 truncate font-display text-[14px] font-medium tabular-nums text-ink-100">
        {value}
      </div>
    </div>
  );
}
