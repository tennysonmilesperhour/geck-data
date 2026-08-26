import type { SoldRow } from "@/components/sold/SortableSoldTable";

export type SoldFilters = {
  morph?: string;
  maturity?: string;
  sex?: string;
};

export function normaliseMaturity(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const lower = value.toLowerCase();
  if (lower.startsWith("juv")) return "Juvenile";
  if (lower.startsWith("sub")) return "Subadult";
  if (lower.startsWith("adult")) return "Adult";
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
