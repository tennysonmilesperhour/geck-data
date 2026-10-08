"use client";

// The value report. The server renders the unfiltered report into the cached
// page. A shared link such as /?t=lilly-white&sex=female is the same document;
// this component reads the URL and swaps in the cached report for that gecko.
import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Morph, PriceBand } from "@/lib/simple/data";
import {
  AGE_LABEL,
  SEX_LABEL,
  estimate,
  gridKey,
  type AgeClass,
  type Estimate,
  type SexClass,
  type ValueGrid,
} from "@/lib/simple/estimate";
import { GROUPS, traitInfo } from "@/lib/simple/genetics";
import {
  encodeReportKey,
  isDefaultReport,
  parseReportState,
  reportApiPath,
  reportHref,
  type ReportState,
} from "@/lib/simple/report-state";
import type { GridEntries, ValueReportData } from "@/lib/simple/report-types";
import {
  Card,
  Empty,
  ListingGrid,
  PriceRangeBar,
  PriceScale,
  Section,
  TextLink,
  fmtMonthRange,
  fmtShortDate,
  niceMax,
} from "@/components/simple/ui";
import { UpgradeList, ValueGridTable } from "@/components/simple/value";
import GrowthChart from "@/components/simple/GrowthChart";
import SaveAlert from "@/components/simple/SaveAlert";
import { fmtInt, fmtUsd } from "@/lib/format";

function asGrid(entries: GridEntries): ValueGrid {
  return new Map(entries);
}

function toggle(slugs: string[], slug: string): string[] {
  return slugs.includes(slug) ? slugs.filter((s) => s !== slug) : [...slugs, slug];
}

export function ValueReport({
  morphs,
  initial,
}: {
  morphs: Morph[];
  initial: ValueReportData;
}) {
  const sp = useSearchParams();
  const requested = parseReportState({
    t: sp.get("t"),
    sex: sp.get("sex"),
    age: sp.get("age"),
  });
  const requestKey = encodeReportKey(requested);
  const path = reportApiPath(requested);
  const [report, setReport] = useState(initial);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const active = requestKey === initial.requestKey ? initial : report;
  const pending = active.requestKey !== requestKey && failedKey !== requestKey;
  const failed = failedKey === requestKey && active.requestKey !== requestKey;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (pending || failed) root.setAttribute("data-report-filter", "1");
    else root.removeAttribute("data-report-filter");
  }, [pending, failed]);

  useEffect(() => {
    if (!pending) return;
    const ac = new AbortController();
    fetch(path, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as ValueReportData;
      })
      .then((data) => {
        if (data?.requestKey === requestKey) {
          setReport(data);
          setFailedKey(null);
        } else {
          setFailedKey(requestKey);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailedKey(requestKey);
      });
    return () => ac.abort();
  }, [pending, requestKey, path]);

  if (pending || failed) {
    return (
      <div className="mx-auto max-w-5xl space-y-12">
        <ReportIntro />
        <Picker morphs={morphs} state={requested} />
        <p className="text-lg text-ink-300">
          {failed ? "Prices could not load. Try again in a minute." : "Loading this gecko's prices…"}
        </p>
      </div>
    );
  }

  return <ValueReportView morphs={morphs} report={active} />;
}

export function ValueReportView({
  morphs,
  report,
}: {
  morphs: Morph[];
  report: ValueReportData;
}) {
  const state: ReportState = { slugs: report.slugs, sex: report.sex, age: report.age };
  const grid = asGrid(report.grid);
  const marketGrid = asGrid(report.marketGrid);
  const est = estimate(grid, marketGrid, report.age, report.sex);
  const baseline = marketGrid.get(gridKey("any", "any"))?.p50 ?? null;
  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));
  const name = describe(report.traits, report.sex, report.age);

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <ReportIntro />
      <Picker morphs={morphs} state={state} />

      <Headline
        name={name}
        est={est}
        baseline={baseline}
        sold={report.sold}
        asking={report.asking}
        hasTraits={report.traits.length > 0}
        traits={report.traits}
      />

      <Section
        title="Value by age and sex"
        note={
          report.traits.length
            ? `Typical asking price for ${report.traits.join(" + ")} at each stage. Tap a box to price that gecko.`
            : "Typical asking price for any crested gecko at each stage. Tap a box to price that gecko."
        }
      >
        <ValueGridTable
          grid={grid}
          age={report.age}
          sex={report.sex}
          hrefFor={(a, s) => reportHref({ ...state, age: a, sex: s })}
        />
        <p className="text-xs text-ink-500">
          Most crested geckos can&apos;t be sexed until they reach roughly 15 to 25 grams,
          which is why so many hatchlings are sold unsexed and cheaper.
        </p>
      </Section>

      {report.growth.length ? (
        <Section
          title="How value grows"
          note={
            report.growthIsMarket
              ? `Not enough weights listed for ${report.traits.join(" + ")} yet, so this shows all crested geckos.`
              : "Middle asking price by weight. Only points with enough listings are drawn."
          }
        >
          <Card>
            <GrowthChart points={report.growth} />
          </Card>
        </Section>
      ) : null}

      {report.upgrades.length ? (
        <Section
          title={report.traits.length ? "What one more trait adds" : "Traits that add the most value"}
          note={
            report.traits.length
              ? `Typical asking price when a ${report.traits.join(" + ")} also has the trait. Tap one to add it.`
              : "Typical asking price of geckos with each trait. Tap one to start from it."
          }
        >
          <UpgradeList
            upgrades={report.upgrades}
            hrefFor={(t) => {
              const s = slugOf.get(t);
              return s ? reportHref({ ...state, slugs: [...state.slugs, s] }) : null;
            }}
          />
          <p className="text-xs text-ink-500">
            Compared with the {fmtUsd(report.upgrades[0]?.baseP50)} typical price of{" "}
            {report.traits.length ? report.traits.join(" + ") : "all crested geckos"}. Trait
            combinations also tend to come from stronger lines, so part of the lift is
            the breeding behind them, not the trait alone.
          </p>
        </Section>
      ) : null}

      <Section
        title={state.sex || state.age ? "Geckos like this, listed now" : "Listed now"}
        note={`${fmtInt(report.comps.total)} matching listings, best value first: priced lowest against similar geckos.`}
        action={
          <TextLink href={`${listingsHref(state, false)}${listingsHref(state, false).includes("?") ? "&" : "?"}sort=value`}>
            See all listings
          </TextLink>
        }
      >
        {report.comps.rows.length ? (
          <ListingGrid listings={report.comps.rows} />
        ) : (
          <Empty>Nothing matching is listed right now. Try removing the age or sex.</Empty>
        )}
      </Section>

      {report.recentSold.rows.length ? (
        <Section
          title="Recently sold"
          note="The last asking price before the listing came down."
          action={<TextLink href={listingsHref(state, true)}>See all sold</TextLink>}
        >
          <ListingGrid listings={report.recentSold.rows} />
        </Section>
      ) : null}

      <p className="text-sm text-ink-500">
        Prices are asking prices from MorphMarket listings seen since May 2026. Pattern
        quality, lineage and size move real prices a lot.{" "}
        <Link href="/methodology" className="text-ink-300 underline hover:text-ink-100">
          How this works
        </Link>
      </p>
    </div>
  );
}

function ReportIntro() {
  return (
    <header className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
        What is your crested gecko worth?
      </h1>
      <p className="mt-4 text-lg leading-8 text-ink-300">
        Describe your gecko and see what geckos like it are listed and sold for, how
        the price changes as it grows, and which traits add the most value.
      </p>
    </header>
  );
}

function listingsHref(s: ReportState, sold: boolean): string {
  const p = new URLSearchParams();
  if (sold) p.set("status", "sold");
  if (s.slugs.length) p.set("t", s.slugs.join(","));
  if (s.sex === "male" || s.sex === "female") p.set("sex", s.sex);
  if (s.age && !sold) p.set("age", s.age);
  const q = p.toString().replace(/%2C/g, ",");
  return q ? `/listings?${q}` : "/listings";
}

function describe(traits: string[], sex: SexClass | null, age: AgeClass | null): string {
  const bits: string[] = [];
  if (sex === "female" || sex === "male") bits.push(SEX_LABEL[sex].toLowerCase());
  if (sex === "unsexed") bits.push("unsexed");
  if (age) bits.push(AGE_LABEL[age].toLowerCase());
  const who = traits.length ? traits.join(" + ") : "crested gecko";
  const s = [...bits, who].join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Picker({ morphs, state }: { morphs: Morph[]; state: ReportState }) {
  if (!morphs.length) {
    return <Empty>Morph list could not load right now. Try again in a minute.</Empty>;
  }
  const picked = morphs.filter((m) => state.slugs.includes(m.slug));
  const anything = !isDefaultReport(state);
  return (
    <section className="rounded-lg border border-ink-700 bg-ink-850 shadow-edge">
      <header className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-700 px-5 py-2.5">
        <h2 className="text-sm font-semibold text-ink-50">Your gecko</h2>
        {picked.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {picked.map((m) => (
              <Link
                key={m.slug}
                href={reportHref({ ...state, slugs: toggle(state.slugs, m.slug) })}
                scroll={false}
                title={`Remove ${m.trait}`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-claude/50 bg-claude/15 px-2 py-0.5 text-[13px] text-ink-50 transition hover:border-claude"
              >
                {m.trait}
                <span aria-hidden="true" className="text-ink-400">×</span>
                <span className="sr-only">Remove</span>
              </Link>
            ))}
          </div>
        ) : null}
        {anything ? (
          <Link href="/" scroll={false} className="ml-auto text-[13px] text-ink-400 hover:text-ink-100">
            Start over
          </Link>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-5 pb-5 pt-4 md:grid-cols-3">
        {GROUPS.map((g) => (
          <MorphGroup
            key={g.id}
            title={g.title}
            morphs={morphs.filter((m) => traitInfo(m.trait).group === g.id)}
            state={state}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-ink-700 px-5 py-4 md:grid-cols-2">
        <Segmented
          label="Sex"
          options={[
            { value: "female", label: "Female" },
            { value: "male", label: "Male" },
            { value: "unsexed", label: "Not sexed" },
            { value: null, label: "Any" },
          ]}
          current={state.sex}
          hrefFor={(v) => reportHref({ ...state, sex: v as SexClass | null })}
        />
        <Segmented
          label="Age"
          options={[
            { value: "hatchling", label: "Hatchling" },
            { value: "juvenile", label: "Juvenile" },
            { value: "subadult", label: "Subadult" },
            { value: "adult", label: "Adult" },
            { value: null, label: "Any" },
          ]}
          current={state.age}
          hrefFor={(v) => reportHref({ ...state, age: v as AgeClass | null })}
        />
      </div>
    </section>
  );
}

const GROUP_TOP = 6;

function MorphGroup({ title, morphs, state }: { title: string; morphs: Morph[]; state: ReportState }) {
  if (!morphs.length) return null;
  const sorted = [...morphs].sort((a, b) => b.forSale - a.forSale);
  const top = sorted.filter((m, i) => i < GROUP_TOP || state.slugs.includes(m.slug));
  const more = sorted.filter((m) => !top.includes(m));
  return (
    <div>
      <div className="grid grid-cols-[1fr_44px_52px] items-baseline gap-2 border-b border-ink-700 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
        <span>{title}</span>
        <span className="text-right">Listed</span>
        <span className="text-right">Typical</span>
      </div>
      <ul className="pt-1">
        {top.map((m) => (
          <MorphRow key={m.slug} m={m} state={state} />
        ))}
      </ul>
      {more.length ? (
        <details className="group">
          <summary className="cursor-pointer list-none py-1.5 text-[13px] text-ink-400 hover:text-ink-100 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{more.length} more</span>
            <span className="hidden group-open:inline">Fewer</span>
          </summary>
          <ul>
            {more.map((m) => (
              <MorphRow key={m.slug} m={m} state={state} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function MorphRow({ m, state }: { m: Morph; state: ReportState }) {
  const on = state.slugs.includes(m.slug);
  return (
    <li>
      <Link
        href={reportHref({ ...state, slugs: toggle(state.slugs, m.slug) })}
        scroll={false}
        aria-pressed={on}
        className="-mx-1.5 grid grid-cols-[14px_1fr_44px_52px] items-center gap-2 rounded-sm px-1.5 py-[5px] transition hover:bg-ink-750"
      >
        <span
          aria-hidden="true"
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border ${
            on ? "border-claude bg-claude" : "border-ink-600"
          }`}
        >
          {on ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5.2 4.1 7.2 8 3" stroke="white" strokeWidth="1.6" />
            </svg>
          ) : null}
        </span>
        <span className={`truncate text-[13px] ${on ? "font-medium text-ink-50" : "text-ink-200"}`}>
          {m.trait}
        </span>
        <span className="text-right text-xs tabular-nums text-ink-500">{fmtInt(m.forSale)}</span>
        <span className="text-right text-xs tabular-nums text-ink-300">
          {m.askMid != null ? fmtUsd(m.askMid) : ""}
        </span>
      </Link>
    </li>
  );
}

function Segmented({
  label,
  options,
  current,
  hrefFor,
}: {
  label: string;
  options: Array<{ value: string | null; label: string }>;
  current: string | null;
  hrefFor: (v: string | null) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">{label}</div>
      <div
        className="grid overflow-hidden rounded border border-ink-700 bg-ink-900"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o, i) => {
          const active = o.value === current;
          return (
            <Link
              key={o.label}
              href={hrefFor(o.value)}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={`truncate px-1 py-1.5 text-center text-xs transition sm:px-2 sm:text-[13px] ${
                i ? "border-l border-ink-700" : ""
              } ${active ? "bg-ink-700 font-medium text-ink-50" : "text-ink-400 hover:bg-ink-800 hover:text-ink-100"}`}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Headline({
  name,
  est,
  baseline,
  sold,
  asking,
  hasTraits,
  traits,
}: {
  traits: string[];
  name: string;
  est: Estimate | null;
  baseline: number | null;
  sold: PriceBand | null;
  asking: PriceBand | null;
  hasTraits: boolean;
}) {
  if (!est) {
    return <Empty>Not enough listings match {name}. Try removing a morph.</Empty>;
  }
  const ratio = baseline && hasTraits ? est.mid / baseline : null;
  const basis =
    est.basis === "exact"
      ? `Based on ${fmtInt(est.n)} listings of exactly this kind of gecko.`
      : est.basis === "adjusted"
        ? `Only a few listings match this exact age and sex, so this takes ${fmtInt(est.n)} listings of these morphs and adjusts for age and sex using the whole crested market.`
        : `Based on ${fmtInt(est.n)} listings. Pick a sex and age for a tighter estimate.`;
  const scaleMax = niceMax(Math.max(sold?.p90 ?? 0, asking?.p90 ?? 0, est.high, 100));

  return (
    <Card className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm text-ink-400">{name}, typical asking price</div>
          <div className="mt-1 text-4xl font-semibold tabular-nums text-ink-50 sm:text-5xl">
            {fmtUsd(est.low)} to {fmtUsd(est.high)}
          </div>
          <div className="mt-2 text-base text-ink-300">
            Middle price {fmtUsd(est.mid)}. Half of geckos like this are listed in this
            range.
          </div>
        </div>
        {ratio ? (
          <div className="shrink-0 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-center">
            <div className="text-2xl font-semibold tabular-nums text-ink-50">
              {ratio.toFixed(1)}×
            </div>
            <div className="text-xs text-ink-400">
              a typical crested
              <br />({fmtUsd(baseline)})
            </div>
          </div>
        ) : null}
      </div>
      <p className="text-sm text-ink-400">{basis}</p>
      {hasTraits ? (
        <SaveAlert
          label={`Alert me when one is listed under ${fmtUsd(est.low)}`}
          name={`${traits.join(" + ")} under ${fmtUsd(est.low)}`}
          query={{ trait_all: traits, max_price: est.low }}
        />
      ) : null}

      <div className="space-y-4 border-t border-ink-700 pt-5">
        <div className="text-sm font-medium text-ink-200">
          {hasTraits ? "For these morphs at any age and sex" : "For any crested gecko"}
        </div>
        <BandRow
          title="Sold for"
          detail={
            sold
              ? `${fmtInt(sold.n)} sales, ${fmtMonthRange(sold.oldest, sold.newest)}`
              : "No matching sales"
          }
          band={sold}
          scaleMax={scaleMax}
        />
        <BandRow
          title="Listed now"
          detail={
            asking
              ? `${fmtInt(asking.n)} listings, last checked ${fmtShortDate(asking.newest)}`
              : "Nothing listed right now"
          }
          band={asking}
          scaleMax={scaleMax}
        />
        <PriceScale max={scaleMax} />
        <p className="text-xs leading-5 text-ink-500">
          The tick is the middle price, the bar covers the middle half, and the hairline
          runs from the cheapest tenth to the priciest tenth. Sold prices are the last asking
          price before a listing came down, not a confirmed payment.
        </p>
      </div>
    </Card>
  );
}

function BandRow({
  title,
  detail,
  band,
  scaleMax,
}: {
  title: string;
  detail: string;
  band: PriceBand | null;
  scaleMax: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-5">
      <div>
        <div className="font-medium text-ink-100">
          {title}{" "}
          {band ? (
            <span className="tabular-nums text-ink-300">
              {fmtUsd(band.p25)} to {fmtUsd(band.p75)}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-ink-500">{detail}</div>
      </div>
      {band ? <PriceRangeBar band={band} scaleMax={scaleMax} /> : <div className="text-sm text-ink-500">No data</div>}
    </div>
  );
}
