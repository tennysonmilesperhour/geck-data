// How prices work, in plain language. Every number on the site traces back
// to one of the sections below.
import Link from "next/link";
import { PageIntro } from "@/components/simple/ui";

export const metadata = {
  title: "How prices work - Geck Inspect Market",
  description:
    "Where Geck Inspect Market prices come from, how the value estimate is built, and what the numbers can and cannot tell you.",
};

const SECTIONS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Where the prices come from",
    body: (
      <>
        <p>
          Every price comes from a public crested gecko listing on MorphMarket. A
          scraper reads the listings and records the price, morphs, sex, age, weight
          and seller. Each listing card on this site shows when it was last checked.
        </p>
        <p>
          Prices are in US dollars. The small share of listings in other currencies is
          left out of price math so a Canadian price is never mixed in as if it were
          USD.
        </p>
      </>
    ),
  },
  {
    title: "Asking price versus sold price",
    body: (
      <>
        <p>
          An <strong>asking price</strong> is what a seller listed the gecko for. Most
          numbers on the site are asking prices, because every listing has one.
        </p>
        <p>
          A <strong>sold price</strong> is the last asking price we saw before a
          listing came down. It is not a confirmed payment: a buyer may have negotiated,
          and a few listings come down for other reasons. The sales history covers May
          and June 2026.
        </p>
      </>
    ),
  },
  {
    title: "How the value estimate works",
    body: (
      <>
        <p>The price check narrows from any crested gecko to one described animal:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            If at least 5 listings match the morphs, age and sex exactly, the estimate
            is the middle half of their asking prices.
          </li>
          <li>
            If fewer match, it starts from all listings with those morphs and adjusts
            for age and sex using how much age and sex move prices across the whole
            crested market. A car pricing guide adjusts a base value for options the
            same way.
          </li>
          <li>With no age or sex picked, it uses all listings with those morphs.</li>
        </ol>
        <p>The page always says which of these it used and how many listings it rests on.</p>
      </>
    ),
  },
  {
    title: "Value by age and sex",
    body: (
      <p>
        Each box is the middle asking price for one stage of growth and one sex, with the
        middle half of prices underneath. Age comes from the listing: MorphMarket&apos;s
        &quot;Baby&quot; is shown as Hatchling. A box with fewer than 5 listings says
        &quot;Too few&quot; instead of showing a number that could swing on one gecko.
      </p>
    ),
  },
  {
    title: "How value grows",
    body: (
      <p>
        The growth chart groups listings by weight (under 5 grams up to 50 grams and
        over) and draws the middle asking price for females, males and unsexed geckos.
        A point is only drawn when at least 6 listings back it. When a morph has too few
        weights listed, the chart shows all crested geckos and says so.
      </p>
    ),
  },
  {
    title: "What one more trait adds",
    body: (
      <p>
        For the morphs you picked, each row is the middle asking price of listings that
        also carry one more trait, next to the price without it. Only traits on at least
        5 such listings are shown. This is a comparison, not a guarantee: geckos with more
        traits often come from stronger lines, so part of the difference is the breeding
        behind them.
      </p>
    ),
  },
  {
    title: "Compared with a typical crested",
    body: (
      <p>
        &quot;2.1×&quot; means the morph&apos;s middle asking price is 2.1 times the
        middle asking price of every crested gecko listing we have seen. It puts every
        morph on one scale so any two can be compared.
      </p>
    ),
  },
  {
    title: "Genes, patterns and colors",
    body: (
      <p>
        Morphs are grouped by how they are passed on. Genes (Lilly White, Axanthic,
        Cappuccino, Sable, Phantom, Empty Back, and the emerging Soft Scale and Hypo)
        follow predictable inheritance. Patterns and colors are line-bred over
        generations. The genetics follow the{" "}
        <a href="https://geckinspect.com/GeneticsGuide" className="underline hover:text-ink-50">
          Geck Inspect genetics guide
        </a>
        . &quot;Emerging&quot; means only a few breeders have documented it so far.
      </p>
    ),
  },
  {
    title: "What gets filtered out",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Seller questionnaire labels that are not morphs, such as &quot;Diet: Meal
          Replacement&quot; or &quot;Proven breeder: No&quot;.
        </li>
        <li>Prices of zero or over $100,000, which are placeholders or typos.</li>
        <li>Group lots, from the sold price bands.</li>
        <li>Species other than crested geckos.</li>
      </ul>
    ),
  },
  {
    title: "What the numbers cannot tell you",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Pattern quality, color intensity, structure and lineage move real prices a lot,
          and listings rarely describe them in a way that can be measured.
        </li>
        <li>
          About 4 in 10 listings carry no morph tags, so they count toward the whole
          market but not toward any morph.
        </li>
        <li>
          Not every listing is rechecked every week. The{" "}
          <Link href="/status" className="underline hover:text-ink-50">
            data status
          </Link>{" "}
          page shows how current the catalog is.
        </li>
      </ul>
    ),
  },
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageIntro title="How prices work">
        Where every number on this site comes from, and what it can and cannot tell you.
      </PageIntro>
      <div className="space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title} className="space-y-3">
            <h2 className="text-xl font-semibold text-ink-50">{s.title}</h2>
            <div className="space-y-3 text-base leading-7 text-ink-300">{s.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
