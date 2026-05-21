// Lineage-tier inference for breeders.
//
// /data/market.json previously hardcoded `lineage_tier: "regional_known"`
// for every transaction and every breeder. The output filter on
// geck-inspect's market dashboard was therefore cosmetic.
//
// This module classifies a seller into a tier from observable signals:
//   - rating + feedback count (proxy for transaction history)
//   - active listing count (operating scale)
//   - sold-in-window count (recent activity)
//   - membership badge (Premium / Sponsor → committed operator)
//
// The taxonomy mirrors what geck-inspect filters on:
//   foundational    — globally recognised, decades of provenance
//   proven_breeder  — high feedback + sustained activity
//   regional_known  — established but limited operating window
//   emerging        — active but light track record
//   unknown         — insufficient signal

export type LineageTier =
  | "foundational"
  | "proven_breeder"
  | "regional_known"
  | "emerging"
  | "unknown";

export type LineageInputs = {
  feedback_count?: number | null;
  seller_rating_score?: number | null;
  total_listings?: number | null;
  sold_in_window?: number | null;
  membership?: string | null;
};

/**
 * Hand-tuned thresholds. Calibrated against the seller_stats view in
 * 0017_sellers.sql — the top quartile of feedback_count is ~400, the median
 * ~30. Until we have ground-truth tier labels these thresholds are the best
 * we can do without ML.
 */
export function classifyLineage(s: LineageInputs): LineageTier {
  const feedback = s.feedback_count ?? 0;
  const rating = s.seller_rating_score ?? 0;
  const listings = s.total_listings ?? 0;
  const sold = s.sold_in_window ?? 0;
  const mem = (s.membership ?? "").toLowerCase();

  // Foundational: rare. Heavy feedback AND high rating AND scale.
  if (feedback >= 750 && rating >= 4.8 && listings >= 40) {
    return "foundational";
  }
  // Proven breeder: solid feedback OR sponsor-tier membership with sales.
  if ((feedback >= 200 && rating >= 4.6) || (mem.includes("sponsor") && sold >= 5)) {
    return "proven_breeder";
  }
  // Regional known: moderate volume, lukewarm-to-good rating.
  if (feedback >= 30 || (listings >= 10 && rating >= 4.0)) {
    return "regional_known";
  }
  // Emerging: any signal at all.
  if (feedback > 0 || listings > 0 || sold > 0) {
    return "emerging";
  }
  return "unknown";
}
