// URL state for the value report. Shared by the page, the client picker,
// and the cached report route so a link, the back button, and the fetch
// all describe the same gecko.
import { AGE_CLASSES, SEX_CLASSES, type AgeClass, type SexClass } from "./estimate";

export type ReportState = {
  slugs: string[];
  sex: SexClass | null;
  age: AgeClass | null;
};

const SLUG = /^[a-z0-9-]+$/;

export function parseReportState(input: {
  t?: string | null;
  sex?: string | null;
  age?: string | null;
}): ReportState {
  const slugs = (input.t ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => SLUG.test(x))
    .slice(0, 6);
  const sexRaw = (input.sex ?? "").trim();
  const ageRaw = (input.age ?? "").trim();
  return {
    slugs,
    sex: (SEX_CLASSES as string[]).includes(sexRaw) ? (sexRaw as SexClass) : null,
    age: (AGE_CLASSES as string[]).includes(ageRaw) ? (ageRaw as AgeClass) : null,
  };
}

/** Stable cache key. Trait order does not change the price, so it is sorted. */
export function encodeReportKey(s: ReportState): string {
  return `${[...s.slugs].sort().join(",")}|${s.sex ?? ""}|${s.age ?? ""}`;
}

export function isDefaultReport(s: ReportState): boolean {
  return s.slugs.length === 0 && !s.sex && !s.age;
}

/** "-" stands in for "any" so the path always has three segments. Slug order
 *  stays as the reader picked it; encodeReportKey sorts for comparison. */
export function reportApiPath(s: ReportState): string {
  const traits = s.slugs.length ? s.slugs.join(",") : "-";
  return `/api/value-report/${traits}/${s.sex ?? "-"}/${s.age ?? "-"}`;
}

export function stateFromReportPath(traits: string, sex: string, age: string): ReportState {
  return parseReportState({
    t: traits === "-" ? "" : traits,
    sex: sex === "-" ? "" : sex,
    age: age === "-" ? "" : age,
  });
}

export function reportHref(s: ReportState): string {
  const p = new URLSearchParams();
  if (s.slugs.length) p.set("t", s.slugs.join(","));
  if (s.sex) p.set("sex", s.sex);
  if (s.age) p.set("age", s.age);
  const q = p.toString().replace(/%2C/g, ",");
  return q ? `/?${q}` : "/";
}
