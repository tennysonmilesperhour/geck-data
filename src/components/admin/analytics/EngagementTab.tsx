"use client";
// Engagement tab — telemetry-driven. Reads only from user_events; if nothing
// has been captured yet, shows the actionable empty state from the source app.
import { useMemo } from "react";
import KpiCard from "@/components/ui/KpiCard";
import { Panel } from "@/components/ui/Panel";
import { AreaChart, PALETTE } from "./charts";
import {
  activeUsersInWindow,
  daySeries,
  pctChange,
  windowFor,
} from "./aggregations";
import type { DataBundle, Period } from "./types";

export default function EngagementTab({
  data,
  period,
}: {
  data: DataBundle | null;
  period: Period;
}) {
  const agg = useMemo(
    () => (data ? computeEngagement(data, period) : null),
    [data, period],
  );

  if (!data || !agg) return <Placeholder label="Loading engagement…" />;

  if (agg.totalEvents === 0) {
    return (
      <Panel
        title="No telemetry captured in this window yet."
        subtitle="Events will appear once users interact with instrumented pages."
      >
        <div className="space-y-2 text-sm text-ink-300">
          <p>
            Instrument a user flow by importing{" "}
            <code className="rounded bg-ink-850 px-1.5 py-0.5 text-ink-100">
              trackEvent
            </code>{" "}
            from{" "}
            <code className="rounded bg-ink-850 px-1.5 py-0.5 text-ink-100">
              @/lib/telemetry
            </code>{" "}
            and calling it from the click handlers you care about. Page views
            are already captured automatically by the root layout.
          </p>
          <pre className="mt-3 rounded-md border border-ink-700 bg-ink-850 p-3 text-xs text-ink-200">
{`import { trackEvent } from "@/lib/telemetry";

trackEvent("upload_started", { filename });
trackEvent("alert_created", { query_type });`}
          </pre>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Active users"
          value={agg.activeUsers.toLocaleString()}
          sub={`${agg.activePct}% of ${data.profiles.length.toLocaleString()} total`}
          tone="positive"
        />
        <KpiCard
          label="Return rate"
          value={`${agg.returnPct}%`}
          sub={`${agg.returned}/${agg.priorSignups} of prior-period signups`}
        />
        <KpiCard
          label="Events recorded"
          value={agg.totalEvents.toLocaleString()}
          delta={{ value: agg.eventsDeltaPct, label: "vs prior" }}
          sub={`${agg.priorEvents.toLocaleString()} prior`}
          tone="info"
        />
        <KpiCard
          label="Sessions"
          value={agg.sessions.toLocaleString()}
          delta={{ value: agg.sessionsDeltaPct, label: "vs prior" }}
          sub={`${agg.priorSessions.toLocaleString()} prior`}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Daily active users"
          subtitle="Distinct user_email per day from instrumented events."
        >
          <AreaChart data={agg.dauSeries} color={PALETTE.blue} />
        </Panel>
        <Panel
          title="Top pages"
          subtitle="Most-visited routes. Sessions column counts distinct session_id hits per page — raw events overstate hot pages."
        >
          {agg.topPages.length === 0 ? (
            <p className="text-sm text-ink-400">No page views yet.</p>
          ) : (
            <ul className="divide-y divide-ink-700/60 text-sm">
              <li className="flex items-center justify-between gap-4 px-1 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-500">
                <span>Page</span>
                <span className="flex w-36 justify-between">
                  <span>Events</span>
                  <span>Sessions</span>
                </span>
              </li>
              {agg.topPages.map((p) => (
                <li
                  key={p.page}
                  className="flex items-center justify-between gap-4 px-1 py-1.5"
                >
                  <span className="truncate text-ink-100">{p.page}</span>
                  <span className="flex w-36 justify-between font-mono text-[12px] text-ink-300">
                    <span>{p.events.toLocaleString()}</span>
                    <span>{p.sessions.toLocaleString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
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

function computeEngagement(data: DataBundle, period: Period) {
  const { now, currStartMs, prevStartMs } = windowFor(period);

  const inCurr = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= currStartMs && t <= now;
  };
  const inPrev = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= prevStartMs && t < currStartMs;
  };

  const currEvents = data.events.filter((e) => inCurr(e.created_date));
  const prevEvents = data.events.filter((e) => inPrev(e.created_date));

  const totalEvents = currEvents.length;
  const priorEvents = prevEvents.length;
  const eventsDeltaPct = pctChange(totalEvents, priorEvents);

  const sessions = new Set(currEvents.map((e) => e.session_id).filter(Boolean)).size;
  const priorSessions = new Set(prevEvents.map((e) => e.session_id).filter(Boolean)).size;
  const sessionsDeltaPct = pctChange(sessions, priorSessions);

  const active = activeUsersInWindow(
    data.profiles,
    data.listingImages,
    data.alerts,
    data.events,
    currStartMs,
    now,
  );
  const activePct =
    data.profiles.length === 0
      ? 0
      : Math.round((active.size / data.profiles.length) * 100);

  // Return rate — mirror Growth tab.
  const priorSignupIds = new Set(
    data.profiles
      .filter((p) => {
        const t = Date.parse(p.created_at);
        return Number.isFinite(t) && t >= prevStartMs && t < currStartMs;
      })
      .map((p) => p.id),
  );
  const profilesById = new Map(data.profiles.map((p) => [p.id, p]));
  const priorSignups = priorSignupIds.size;
  const priorEmails = new Set(
    Array.from(priorSignupIds)
      .map((id) => profilesById.get(id)?.email ?? null)
      .filter((x): x is string => !!x),
  );
  let returned = 0;
  for (const email of priorEmails) if (active.has(email)) returned += 1;
  const returnPct = priorSignups === 0 ? 0 : Math.round((returned / priorSignups) * 100);

  // Daily active users — distinct user_email per day.
  const dauByDay = new Map<string, Set<string>>();
  for (const e of currEvents) {
    if (!e.user_email) continue;
    const day = e.created_date.slice(0, 10);
    let set = dauByDay.get(day);
    if (!set) {
      set = new Set();
      dauByDay.set(day, set);
    }
    set.add(e.user_email);
  }
  const buckets = Math.min(period, 90);
  // Reuse daySeries on a synthesized day-counts list: one "row" per (day, email).
  const dauRows = Array.from(dauByDay.entries()).flatMap(([day, emails]) =>
    Array.from(emails).map(() => ({ t: day + "T12:00:00Z" })),
  );
  const dauSeries = daySeries(dauRows, buckets, now);

  // Top pages.
  const pageAgg = new Map<string, { events: number; sessions: Set<string> }>();
  for (const e of currEvents) {
    const page = e.page ?? "(unknown)";
    let rec = pageAgg.get(page);
    if (!rec) {
      rec = { events: 0, sessions: new Set() };
      pageAgg.set(page, rec);
    }
    rec.events += 1;
    if (e.session_id) rec.sessions.add(e.session_id);
  }
  const topPages = Array.from(pageAgg.entries())
    .map(([page, rec]) => ({ page, events: rec.events, sessions: rec.sessions.size }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 10);

  return {
    totalEvents,
    priorEvents,
    eventsDeltaPct,
    sessions,
    priorSessions,
    sessionsDeltaPct,
    activeUsers: active.size,
    activePct,
    returned,
    priorSignups,
    returnPct,
    dauSeries,
    topPages,
  };
}
