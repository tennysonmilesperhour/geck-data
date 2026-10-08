// Static terms. No request data, so the page stays prerendered.
import Link from "next/link";
import { PageIntro } from "@/components/simple/ui";

export const metadata = {
  title: "Terms - Geck Inspect Market",
  description: "What the prices on this site are, and what they are not.",
};

const CONTACT = "morphiclabsdata@gmail.com";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageIntro title="Terms of use">
        This is a general template, not legal advice. Using the site means you accept
        these terms.
      </PageIntro>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Informational estimates only</h2>
        <div className="space-y-3 text-base leading-7 text-ink-300">
          <p>
            The numbers on this site are informational market estimates. They are not an
            appraisal, an offer, or a promise that an animal will sell for a shown price.
          </p>
          <p>
            There is no guarantee of accuracy or completeness. Pattern quality, lineage,
            condition, and negotiation move real prices, and listings often leave those
            out. A figure can be wrong, out of date, or based on too few listings to be
            useful.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Where the prices come from</h2>
        <p className="text-base leading-7 text-ink-300">
          Prices are aggregated from public listings. An asking price is what a listing
          showed. A sold price on this site is the last asking price seen before that
          listing came down. It is not a confirmed payment. Someone else may have
          negotiated, and some listings come down for other reasons.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">No marketplace affiliation</h2>
        <p className="text-base leading-7 text-ink-300">
          This site is not affiliated with, endorsed by, or operated by any marketplace.
          Names of marketplaces appear only to say where a public listing was seen.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Limitation of liability</h2>
        <p className="text-base leading-7 text-ink-300">
          You use the site at your own risk. To the fullest extent the law allows, the
          operator is not liable for decisions you make from these estimates, including
          a purchase, a sale, or a price you set, or for losses that follow from errors,
          omissions, or interruptions.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Changes</h2>
        <p className="text-base leading-7 text-ink-300">
          These terms can change. The version on this page is the one that applies. The{" "}
          <Link href="/privacy" className="underline hover:text-ink-50">
            privacy notice
          </Link>{" "}
          describes what the site collects.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Contact</h2>
        <p className="text-base leading-7 text-ink-300">
          Questions about these terms:{" "}
          <a className="underline hover:text-ink-50" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
