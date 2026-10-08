// Home: the value report.
//
// It starts from "any crested gecko" and narrows as the reader describes
// their animal: morphs, then sex, then age. Every choice lives in the URL
// (?t=lilly-white,cappuccino&sex=female&age=adult) so a report can be
// shared and the back button works.
//
// The page does not read searchParams. In Next.js 15 that opts the route
// out of the cache (private, no-store), which made every trait link a fresh
// render against a database on the other coast. The unfiltered report is
// static and revalidated hourly. Filter links stay on this URL; the client
// loads /api/value-report/..., which is cached the same way.
import { Suspense } from "react";
import { getMorphs } from "@/lib/simple/data";
import { loadValueReport } from "@/lib/simple/report";
import { ValueReport, ValueReportView } from "@/components/simple/ValueReport";

export const revalidate = 3600;

// Runs before the report markup is parsed, so a shared filter link does not
// paint the unfiltered prices.
const filterBoot = `(function(){try{var q=location.search;if(/[?&](?:t|sex|age)=/.test(q))document.documentElement.setAttribute("data-report-filter","1");}catch(e){}})();`;

export default async function ValueReportPage() {
  const morphs = await getMorphs();
  const initial = await loadValueReport({ slugs: [], sex: null, age: null }, morphs);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: filterBoot }} />
      <div className="report-pending mx-auto max-w-5xl">
        <p className="text-lg text-ink-300">Loading this gecko&apos;s prices…</p>
      </div>
      <div className="report-body">
        <Suspense fallback={<ValueReportView morphs={morphs} report={initial} />}>
          <ValueReport morphs={morphs} initial={initial} />
        </Suspense>
      </div>
    </>
  );
}
