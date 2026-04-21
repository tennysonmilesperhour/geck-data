"use client";
// Features tab — event-name breakdown. Separates page_view from "real"
// feature events so instrumented actions are visible independent of routing
// noise. Dual metric (count + unique users) on the table, matching the
// source app's pattern.
import { useMemo } from "react";
import KpiCard from "@/components/ui/KpiCard";
import { Panel } from "@/components/ui/Panel";
import { HBarChart, PALETTE } from "./charts";
import { eventBreakdown, windowFor } from "./aggregations";
import type { DataBundle, Period } from "./types";

export default function FeaturesTab({
  data,
  period,
}: {
  data: DataBundle | null;
  period: Period;
}) {
  const agg = useMemo(
    () => (data ? computeFeatures(data, period) : null),
    [data, period],
  );

  if (!data || !agg) return <Placeholder label="Loading features…" />;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          label="Page views"
          value={agg.pageViews.toLocaleString()}
          sub="page_view events in window"
        />
        <KpiCard
          label="Feature events"
          value={agg.featureEvents.toLocaleString()}
          sub="all non-page_view events"
          tone="info"
        />
        <KpiCard
          label="Distinct features"
          value={agg.distinctFeatures.toLocaleString()}
          sub="unique event names in window"
          tone="positive"
        />
      </section>

      {agg.featureEvents === 0 ? (
        <Panel
          title="No feature events captured yet"
          subtitle="page_view is collected automatically from the root layout; feature events need explicit calls."
        >
          <div className="space-y-2 text-sm text-ink-300">
            <p>
              Call{" "}
              <code className="rounded bg-ink-850 px-1.5 py-0.5 text-ink-100">
                trackEvent(name, properties)
              </code>{" "}
              from your click handlers and form submits. Once events land, this
              tab breaks them down by name with both raw volume and the unique
              users the event reached.
            </p>
          </div>
        </Panel>
      ) : (
        <>
          <Panel
            title="Top feature events"
            subtitle="Horizontal bars, top 12 by volume. Excludes page_view."
          >
            <HBarChart
              items={agg.topFeatureEvents.map((e) => ({ label: e.name, value: e.count }))}
              color={PALETTE.purple}
              maxRows={12}
            />
          </Panel>

          <Panel
            title="Event breakdown"
            subtitle="Every distinct event in window. Count is raw volume; users is the unique reach — a 10k-fire event for 3 users is very different from 500 fires across 500 users."
          >
            <div className="max-h-[420px] overflow-y-auto rounded border border-ink-700">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-ink-850 text-left font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  <tr>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2 text-right">Count</th>
                    <th className="px-3 py-2 text-right">Users</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/60">
                  {agg.allBreakdown.map((e) => (
                    <tr key={e.name} className="hover:bg-ink-850">
                      <td className="px-3 py-1.5 text-ink-100">
                        <code className="font-mono text-xs">{e.name}</code>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                        {e.count.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-ink-300">
                        {e.users.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800 p-8 text-sm text-ink-400">
      {label}
    </div>
  );
}

function computeFeatures(data: DataBundle, period: Period) {
  const { now, currStartMs } = windowFor(period);
  const curr = data.events.filter((e) => {
    const t = Date.parse(e.created_date);
    return Number.isFinite(t) && t >= currStartMs && t <= now;
  });

  const pageViews = curr.filter((e) => e.event_name === "page_view").length;
  const featureCurr = curr.filter((e) => e.event_name !== "page_view");

  const allBreakdown = eventBreakdown(curr);
  const featureBreakdown = allBreakdown.filter((e) => e.name !== "page_view");
  const topFeatureEvents = featureBreakdown.slice(0, 12);

  return {
    pageViews,
    featureEvents: featureCurr.length,
    distinctFeatures: featureBreakdown.length,
    topFeatureEvents,
    allBreakdown,
  };
}
