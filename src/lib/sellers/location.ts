export type ParsedSellerLocation = {
  countryCode: string | null;
  country: string | null;
  usState: string | null;
};

export type LocationCount = {
  label: string;
  count: number;
};

export type SellerLocationSummary = {
  total: number;
  missing: number;
  unclassified: number;
  countryKnown: number;
  countries: LocationCount[];
  usSellerCount: number;
  usStateKnown: number;
  usStates: LocationCount[];
};

export const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ["Alabama", "AL"],
  ["Alaska", "AK"],
  ["Arizona", "AZ"],
  ["Arkansas", "AR"],
  ["California", "CA"],
  ["Colorado", "CO"],
  ["Connecticut", "CT"],
  ["Delaware", "DE"],
  ["Florida", "FL"],
  ["Georgia", "GA"],
  ["Hawaii", "HI"],
  ["Idaho", "ID"],
  ["Illinois", "IL"],
  ["Indiana", "IN"],
  ["Iowa", "IA"],
  ["Kansas", "KS"],
  ["Kentucky", "KY"],
  ["Louisiana", "LA"],
  ["Maine", "ME"],
  ["Maryland", "MD"],
  ["Massachusetts", "MA"],
  ["Michigan", "MI"],
  ["Minnesota", "MN"],
  ["Mississippi", "MS"],
  ["Missouri", "MO"],
  ["Montana", "MT"],
  ["Nebraska", "NE"],
  ["Nevada", "NV"],
  ["New Hampshire", "NH"],
  ["New Jersey", "NJ"],
  ["New Mexico", "NM"],
  ["New York", "NY"],
  ["North Carolina", "NC"],
  ["North Dakota", "ND"],
  ["Ohio", "OH"],
  ["Oklahoma", "OK"],
  ["Oregon", "OR"],
  ["Pennsylvania", "PA"],
  ["Rhode Island", "RI"],
  ["South Carolina", "SC"],
  ["South Dakota", "SD"],
  ["Tennessee", "TN"],
  ["Texas", "TX"],
  ["Utah", "UT"],
  ["Vermont", "VT"],
  ["Virginia", "VA"],
  ["Washington", "WA"],
  ["West Virginia", "WV"],
  ["Wisconsin", "WI"],
  ["Wyoming", "WY"],
  ["District of Columbia", "DC"],
];

const STATE_BY_CODE = new Map(US_STATES.map(([name, code]) => [code, name]));
const STATES_BY_NAME_LENGTH = [...US_STATES].sort(
  ([a], [b]) => b.length - a.length,
);

const CANADIAN_PROVINCE_CODES = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

// MorphMarket sometimes emits a Canadian city followed by the country code
// `CA`, which is otherwise indistinguishable from California. Keep this list
// deliberately conservative: a false Canadian match would remove a real US
// seller from the state chart.
const KNOWN_CANADIAN_PLACES =
  /\b(?:coquitlam|digby|quebec city|salaberry-de-valleyfield|toronto|montreal|vancouver|calgary|ottawa|edmonton|winnipeg|halifax|saskatoon|regina)\b/i;

const NAMED_COUNTRIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:United Kingdom|England|Scotland|Wales|Northern Ireland)\b/i, "GB"],
  [/\bAustralia\b/i, "AU"],
  [/\bNew Zealand\b/i, "NZ"],
  [/\bFrance\b/i, "FR"],
  [/\bGermany\b/i, "DE"],
  [/\bItaly\b/i, "IT"],
  [/\bSpain\b/i, "ES"],
  [/\bNetherlands\b/i, "NL"],
  [/\bBelgium\b/i, "BE"],
  [/\bPoland\b/i, "PL"],
  [/\bCzech(?:ia| Republic)\b/i, "CZ"],
  [/\bCroatia\b/i, "HR"],
  [/\bJapan\b/i, "JP"],
];

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function countryLabel(code: string): string | null {
  const canonical = code === "UK" ? "GB" : code;
  try {
    const label = REGION_NAMES.of(canonical);
    return label && label !== canonical ? label : null;
  } catch {
    return null;
  }
}

function country(
  code: string,
  usState: string | null = null,
): ParsedSellerLocation {
  const canonical = code === "UK" ? "GB" : code;
  return {
    countryCode: canonical,
    country: countryLabel(canonical),
    usState: canonical === "US" ? usState : null,
  };
}

function parseUsState(location: string): string | null {
  const codeMatch = location.match(
    /(?:^|,\s*)([A-Z]{2})(?:\s*,\s*(?:US|USA|UNITED STATES(?: OF AMERICA)?))?$/i,
  );
  const code = codeMatch?.[1]?.toUpperCase();
  if (code) {
    const state = STATE_BY_CODE.get(code);
    if (state) return state;
  }

  const lower = location.toLowerCase();
  for (const [name] of STATES_BY_NAME_LENGTH) {
    const state = name.toLowerCase();
    if (lower === state || lower.endsWith(`, ${state}`)) return name;
  }
  return null;
}

/**
 * Resolve a free-form marketplace profile location into non-competing grains.
 * An exact two-letter token is treated as an ISO country code because that is
 * how the upstream feed represents country-only profiles. A two-letter token
 * after a city is treated as a US state or Canadian province.
 */
export function parseSellerLocation(
  value: string | null | undefined,
): ParsedSellerLocation {
  const raw = (value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return { countryCode: null, country: null, usState: null };

  if (/^[A-Za-z]{2}$/.test(raw)) {
    const code = raw.toUpperCase();
    return country(code);
  }

  if (
    /\b(?:canada|alberta|british columbia|manitoba|new brunswick|newfoundland(?: and labrador)?|nova scotia|northwest territories|nunavut|prince edward island|quebec|saskatchewan|yukon)\b/i.test(
      raw,
    ) ||
    KNOWN_CANADIAN_PLACES.test(raw)
  ) {
    return country("CA");
  }

  const trailingCode = raw.match(/,\s*([A-Za-z]{2})$/)?.[1]?.toUpperCase();
  if (trailingCode && CANADIAN_PROVINCE_CODES.has(trailingCode)) {
    return country("CA");
  }

  const usState = parseUsState(raw);
  if (
    usState ||
    /\b(?:USA|United States(?: of America)?|America)\b/i.test(raw)
  ) {
    return country("US", usState);
  }

  for (const [pattern, code] of NAMED_COUNTRIES) {
    if (pattern.test(raw)) return country(code);
  }

  if (trailingCode) {
    const label = countryLabel(trailingCode);
    if (label) return country(trailingCode);
  }

  return { countryCode: null, country: null, usState: null };
}

function rankedCounts(counts: Map<string, number>): LocationCount[] {
  return Array.from(counts, ([label, count]) => ({ label, count })).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

export function summarizeSellerLocations(
  rows: Array<{ seller_location: string | null }>,
): SellerLocationSummary {
  const countries = new Map<string, number>();
  const states = new Map<string, number>();
  let missing = 0;
  let unclassified = 0;
  let countryKnown = 0;
  let usSellerCount = 0;
  let usStateKnown = 0;

  for (const row of rows) {
    const raw = row.seller_location?.trim() ?? "";
    if (!raw) {
      missing += 1;
      continue;
    }

    const parsed = parseSellerLocation(raw);
    if (!parsed.country) {
      unclassified += 1;
      continue;
    }

    countryKnown += 1;
    countries.set(parsed.country, (countries.get(parsed.country) ?? 0) + 1);

    if (parsed.countryCode !== "US") continue;
    usSellerCount += 1;
    if (!parsed.usState) continue;
    usStateKnown += 1;
    states.set(parsed.usState, (states.get(parsed.usState) ?? 0) + 1);
  }

  return {
    total: rows.length,
    missing,
    unclassified,
    countryKnown,
    countries: rankedCounts(countries),
    usSellerCount,
    usStateKnown,
    usStates: rankedCounts(states),
  };
}
