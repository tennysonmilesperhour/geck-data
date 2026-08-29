import type { SoldRow } from "@/components/sold/SortableSoldTable";

export type SoldFilters = {
  morph?: string;
  maturity?: string;
  sex?: string;
};

/**
 * Map a raw maturity string onto the age classes the filters offer.
 *
 * MorphMarket emits exactly five values: Adult, Baby, Juvenile, Not Ready and
 * Subadult. Baby and Not Ready both used to fall through to "Unknown", which
 * meant Baby, the second most common age class in the sold pool, could never
 * be filtered for and was pooled with rows that state no age at all.
 *
 * "Subadult" has to be tested before the "sub" prefix would ever catch
 * anything else, and Baby is checked on its own prefix rather than folded into
 * Juvenile, because the two price differently: $190 against $200 on live asks,
 * and a breeder choosing between them is choosing between different animals.
 */
export function normaliseMaturity(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const lower = value.toLowerCase().trim();
  if (lower.startsWith("baby") || lower.startsWith("hatch")) return "Baby";
  if (lower.startsWith("juv")) return "Juvenile";
  if (lower.startsWith("sub")) return "Subadult";
  if (lower.startsWith("adult")) return "Adult";
  // "Not Ready" is a seller saying the animal is not for sale yet, which is
  // not an age class. It stays out of the four rather than being guessed into
  // one of them.
  if (lower.startsWith("not ready")) return "Not ready";
  return "Unknown";
}

export function applySoldFilters(
  rows: SoldRow[],
  filters: SoldFilters,
): SoldRow[] {
  const morph = filters.morph?.toLowerCase().trim();
  const maturity = filters.maturity?.trim();
  const sex = filters.sex?.toLowerCase().trim();

  return rows.filter((row) => {
    if (morph && !(row.title ?? "").toLowerCase().includes(morph)) {
      return false;
    }
    if (maturity && normaliseMaturity(row.maturity) !== maturity) {
      return false;
    }
    if (sex && (row.sex ?? "").toLowerCase() !== sex) {
      return false;
    }
    return true;
  });
}
