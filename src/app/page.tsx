// Home: the value report.
//
// It starts from "any crested gecko" and narrows as the reader describes
// their animal: morphs, then sex, then age. Every choice lives in the URL
// (?t=lilly-white,cappuccino&sex=female&age=adult) so a report can be
// shared and the back button works.
//
// The sections follow how people actually reason about a gecko's price:
//   1. What is it worth?          one range, with how sure we are
//   2. What if it were older / a different sex?   the age x sex grid
//   3. What will it be worth as it grows?         the growth curve
//   4. What would one more trait add?             trait upgrades
//   5. Show me real examples.                     matching listings and sales
import Link from "next/link";
import {
  getAskingBand,
  getGrowthCurve,
  getListings,
  getMorphs,
  getSoldBand,
  getTraitUpgrades,
  getValueGrid,
  traitsFromSlugs,
  type Morph,
  type PriceBand,
} from "@/lib/simple/data";
import {
  AGE_CLASSES,
  AGE_LABEL,
  SEX_CLASSES,
  SEX_LABEL,
  estimate,
  gridKey,
  type AgeClass,
  type Estimate,
  type SexClass,
} from "@/lib/simple/estimate";
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
import { GROUPS, traitInfo } from "@/lib/simple/genetics";
import GrowthChart from "@/components/simple/GrowthChart";
import SaveAlert from "@/components/simple/SaveAlert";
import { fmtInt, fmtUsd } from "@/lib/format";

export const revalidate = 900;

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(",") : v) ?? "";

type State = { slugs: string[]; sex: SexClass | null; age: AgeClass | null };

function parse(sp?: SearchParams): State {
  const slugs = one(sp?.t)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[a-z0-9-]+$/.test(x))
    .slice(0, 6);
  const sexRaw = one(sp?.sex);
  const ageRaw = one(sp?.age);
  return {
    slugs,
    sex: (SEX_CLASSES as string[]).includes(sexRaw) ? (sexRaw as SexClass) : null,
    age: (AGE_CLASSES as string[]).includes(ageRaw) ? (ageRaw as AgeClass) : null,
  };
}

function href(s: State): string {
  const p = new URLSearchParams();
  if (s.slugs.length) p.set("t", s.slugs.join(","));
  if (s.sex) p.set("sex", s.sex);
  if (s.age) p.set("age", s.age);
  const q = p.toString().replace(/%2C/g, ",");
  return q ? `/?${q}` : "/";
}

function toggle(slugs: string[], slug: string): string[] {
  return slugs.includes(slug) ? slugs.filter((s) => s !== slug) : [...slugs, slug];
}

export default async function ValueReportPage({ searchParams }: { searchParams?: SearchParams }) {
  const state = parse(searchParams);
  const morphs = await getMorphs();
  const selected = traitsFromSlugs(morphs, state.slugs);
  const cur: State = { ...state, slugs: selected.map((m) => m.slug) };
  const traits = selected.map((m) => m.trait);

  const [grid, market, growth, marketGrowth, upgrades, sold, asking, comps, recentSold] =
    await Promise.all([
      getValueGrid(traits),
      traits.length ? getValueGrid([]) : Promise.resolve(null),
      getGrowthCurve(traits),
      traits.length ? getGrowthCurve([]) : Promise.resolve(null),
      getTraitUpgrades(traits),
      getSoldBand(traits),
      getAskingBand(traits),
      getListings({
        traits,
        status: "for-sale",
        sex: cur.sex === "male" || cur.sex === "female" ? cur.sex : null,
        age: cur.age,
        sort: "value",
        limit: 8,
      }),
      getListings({ traits, status: "sold", sort: "newest", limit: 4 }),
    ]);
  const marketGrid = market ?? grid;
  const est = estimate(grid, marketGrid, cur.age, cur.sex);
  const baseline = marketGrid.get(gridKey("any", "any"))?.p50 ?? null;

  const growthPoints = growthUsable(growth) ? growth : marketGrowth ?? growth;
  const growthIsMarket = growthPoints !== growth;

  const slugOf = new Map(morphs.map((m) => [m.trait, m.slug]));
  const name = describe(selected.map((m) => m.trait), cur.sex, cur.age);

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
          What is your crested gecko worth?
        </h1>
        <p className="mt-4 text-lg leading-8 text-ink-300">
          Describe your gecko and see what geckos like it are listed and sold for, how
          the price changes as it grows, and which traits add the most value.
        </p>
      </header>

      <Picker morphs={morphs} state={cur} />

      <Headline
        name={name}
        est={est}
        baseline={baseline}
        sold={sold}
        asking={asking}
        hasTraits={traits.length > 0}
        traits={traits}
      />

      <Section
        title="Value by age and sex"
        note={
          traits.length
            ? `Typical asking price for ${traits.join(" + ")} at each stage. Tap a box to price that gecko.`
            : "Typical asking price for any crested gecko at each stage. Tap a box to price that gecko."
        }
      >
        <ValueGridTable
          grid={grid}
          age={cur.age}
          sex={cur.sex}
          hrefFor={(a, s) => href({ ...cur, age: a, sex: s })}
        />
        <p className="text-xs text-ink-500">
          Most crested geckos can&apos;t be sexed until they reach roughly 15 to 25 grams,
          which is why so many hatchlings are sold unsexed and cheaper.
        </p>
      </Section>

      {growthPoints.length ? (
        <Section
          title="How value grows"
          note={
            growthIsMarket
              ? `Not enough weights listed for ${traits.join(" + ")} yet, so this shows all crested geckos.`
              : "Middle asking price by weight. Only points with enough listings are drawn."
          }
        >
          <Card>
            <GrowthChart points={growthPoints} />
          </Card>
        </Section>
      ) : null}

      {upgrades.length ? (
        <Section
          title={traits.length ? "What one more trait adds" : "Traits that add the most value"}
          note={
            traits.length
              ? `Typical asking price when a ${traits.join(" + ")} also has the trait. Tap one to add it.`
              : "Typical asking price of geckos with each trait. Tap one to start from it."
          }
        >
          <UpgradeList
            upgrades={upgrades}
            hrefFor={(t) => {
              const s = slugOf.get(t);
              return s ? href({ ...cur, slugs: [...cur.slugs, s] }) : null;
            }}
          />
          <p className="text-xs text-ink-500">
            Compared with the {fmtUsd(upgrades[0]?.baseP50)} typical price of{" "}
            {traits.length ? traits.join(" + ") : "all crested geckos"}. Trait
            combinations also tend to come from stronger lines, so part of the lift is
            the breeding behind them, not the trait alone.
          </p>
        </Section>
      ) : null}

      <Section
        title={cur.sex || cur.age ? "Geckos like this, listed now" : "Listed now"}
        note={`${fmtInt(comps.total)} matching listings, best value first: priced lowest against similar geckos.`}
        action={
          <TextLink href={`${listingsHref(cur, false)}${listingsHref(cur, false).includes("?") ? "&" : "?"}sort=value`}>See all listings</TextLink>
        }
      >
        {comps.rows.length ? (
          <ListingGrid listings={comps.rows} />
        ) : (
          <Empty>Nothing matching is listed right now. Try removing the age or sex.</Empty>
        )}
      </Section>

      {recentSold.rows.length ? (
        <Section
          title="Recently sold"
          note="The last asking price before the listing came down."
          action={<TextLink href={listingsHref(cur, true)}>See all sold</TextLink>}
        >
          <ListingGrid listings={recentSold.rows} />
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

function growthUsable(points: { sex: string; n: number }[]): boolean {
  const bySex = new Map<string, number>();
  for (const p of points) if (p.n >= 6 && p.sex !== "all") bySex.set(p.sex, (bySex.get(p.sex) ?? 0) + 1);
  return [...bySex.values()].some((c) => c >= 3);
}

function listingsHref(s: State, sold: boolean): string {
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

function Picker({ morphs, state }: { morphs: Morph[]; state: State }) {
  if (!morphs.length) {
    return <Empty>Morph list could not load right now. Try again in a minute.</Empty>;
  }
  const picked = morphs.filter((m) => state.slugs.includes(m.slug));
  const anything = state.slugs.length || state.sex || state.age;
  return (
    <section className="rounded-lg border border-ink-700 bg-ink-850 shadow-edge">
      <header className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-700 px-5 py-2.5">
        <h2 className="text-sm font-semibold text-ink-50">Your gecko</h2>
        {picked.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {picked.map((m) => (
              <Link
                key={m.slug}
                href={href({ ...state, slugs: toggle(state.slugs, m.slug) })}
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
            ...SEX_CLASSES.map((s) => ({ value: s, label: SEX_LABEL[s] })),
            { value: null, label: "Any" },
          ]}
          current={state.sex}
          hrefFor={(v) => href({ ...state, sex: v as SexClass | null })}
        />
        <Segmented
          label="Age"
          options={[
            ...AGE_CLASSES.map((a) => ({ value: a, label: AGE_LABEL[a] })),
            { value: null, label: "Any" },
          ]}
          current={state.age}
          hrefFor={(v) => href({ ...state, age: v as AgeClass | null })}
        />
      </div>
    </section>
  );
}

// How many morphs each group shows before "more". Picked morphs always show.
const GROUP_TOP = 6;

/**
 * One column of the morph checklist: a header, then one row per morph with
 * a checkbox, how many are listed, and the typical asking price. The most
 * listed morphs show first; the rest open under "more".
 */
function MorphGroup({ title, morphs, state }: { title: string; morphs: Morph[]; state: State }) {
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

function MorphRow({ m, state }: { m: Morph; state: State }) {
  const on = state.slugs.includes(m.slug);
  return (
    <li>
      <Link
        href={href({ ...state, slugs: toggle(state.slugs, m.slug) })}
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
    return (
      <Empty>
        Not enough listings match {name}. Try removing a morph.
      </Empty>
    );
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
      {band ? (
        <PriceRangeBar band={band} scaleMax={scaleMax} />
      ) : (
        <div className="text-sm text-ink-500">No data</div>
      )}
    </div>
  );
}
