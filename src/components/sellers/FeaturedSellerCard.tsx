// Editorial-style featured-seller card. Used on the /sellers index
// directly above the full data table. Each card hover-lifts and links
// to /sellers/[id]. Designed to read at-a-glance: name + region +
// inventory size + plan tier.
import Link from "next/link";
import SellerInitials from "./SellerInitials";
import { fmtInt, fmtUsd } from "@/lib/format";

export type FeaturedSeller = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  membership: string | null;
  total_listings: number | null;
  avg_price: number | null;
  seller_rating_score: number | null;
};

export default function FeaturedSellerCard({
  seller,
}: {
  seller: FeaturedSeller;
}) {
  const name = seller.seller_name ?? seller.seller_id;
  const plan = (seller.membership ?? "").trim();
  const rating = seller.seller_rating_score;

  return (
    <Link
      href={`/sellers/${seller.seller_id}`}
      className="surface-elevated hover-lift group block p-5"
    >
      <div className="flex items-start gap-4">
        <SellerInitials name={name} size={52} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[19px] font-medium leading-tight text-ink-50 transition group-hover:text-claude-glow">
            {name}
          </div>
          <div className="mt-1 truncate text-sm text-ink-400">
            {seller.seller_location ?? "Location unknown"}
          </div>
        </div>
        {plan ? <PlanBadge plan={plan} /> : null}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4">
        <Stat
          label="Listings"
          value={fmtInt(seller.total_listings)}
        />
        <Stat
          label="Avg price"
          value={fmtUsd(seller.avg_price)}
        />
        <Stat
          label="Rating"
          value={rating != null ? rating.toFixed(2) : "—"}
        />
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </div>
      <div className="mt-1 font-display text-[18px] font-medium tabular-nums text-ink-100">
        {value}
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  // Lowercase to canonical buckets the badge actually styles.
  const k = plan.toLowerCase();
  const tone =
    k.includes("pro") || k.includes("plus") || k.includes("premium")
      ? "pro"
      : k.includes("basic")
        ? "basic"
        : "neutral";
  const cls = {
    pro: "border-claude-glow/40 bg-claude-glow/10 text-claude-glow",
    basic: "border-ink-600 bg-ink-800 text-ink-300",
    neutral: "border-ink-700 bg-ink-850 text-ink-400",
  }[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${cls}`}
    >
      {plan}
    </span>
  );
}
