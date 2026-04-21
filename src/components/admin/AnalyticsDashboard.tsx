"use client";
// Admin analytics dashboard. Five tabs (Growth / Engagement / Features /
// Retention / Errors) over a single batched fetch. All aggregation happens
// client-side inside useMemo keyed on [data, period] so the period selector
// doesn't trigger a refetch.
//
// This is the equivalent of the original AnalyticsDashboard.jsx, adapted to
// geck-inspect's entity model:
//   Growth tab  — auth signups + market data throughput (new listings, price
//                 drops, sold, cross-platform, show mentions) + images/alerts
//                 as user-content proxies.
//   Engagement  — user_events telemetry (populated by src/lib/telemetry.ts
//                 and by any external source writing with the anon key).
//   Features    — event-name breakdown from user_events.
//   Retention   — weekly signup cohort × weekly event activity.
//   Errors      — error_logs viewer, delegated to ErrorLogsViewer.
//
// Scaling note: this mirrors the source app's Promise.all strategy. Good
// enough up to a few thousand active users; move to SQL views or RPCs once
// user_events grows past ~500k rows.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SectionHeader, StatusPill } from "@/components/ui/Panel";
import ErrorLogsViewer from "@/components/admin/ErrorLogsViewer";
import { fmtRelative } from "@/lib/format";
import { DAY_MS } from "./analytics/aggregations";
import GrowthTab from "./analytics/GrowthTab";
import EngagementTab from "./analytics/EngagementTab";
import FeaturesTab from "./analytics/FeaturesTab";
import RetentionTab from "./analytics/RetentionTab";
import type { DataBundle, Period, Profile, UserEvent } from "./analytics/types";

const PERIODS: Period[] = [7, 30, 90, 365];
const TABS = ["growth", "engagement", "features", "retention", "errors"] as const;
type TabKey = (typeof TABS)[number];

const MAX_PERIOD = 365;

export default function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>(30);
  const [tab, setTab] = useState<TabKey>("growth");
  const [data, setData] = useState<DataBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // Pull user_events across 2× the longest period so prior-period + retention
    // math works without a second round trip, capped at 20k rows.
    const eventWindowMs = 2 * MAX_PERIOD * DAY_MS;
    const sinceIso = new Date(Date.now() - eventWindowMs).toISOString();

    const [
      profilesRes,
      listingsRes,
      dropsRes,
      soldRes,
      crossRes,
      showsRes,
      imagesRes,
      alertsRes,
      eventsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("id, email, role, created_at").limit(20000).then(ok, bad("profiles")),
      supabase
        .from("market_listings")
        .select("first_seen_at")
        .gte("first_seen_at", sinceIso)
        .limit(20000)
        .then(ok, bad("market_listings")),
      supabase
        .from("price_drops")
        .select("observed_at")
        .gte("observed_at", sinceIso)
        .limit(20000)
        .then(ok, bad("price_drops")),
      supabase
        .from("listing_status_events")
        .select("observed_at")
        .eq("status", "sold")
        .gte("observed_at", sinceIso)
        .limit(20000)
        .then(ok, bad("listing_status_events")),
      supabase
        .from("cross_platform_listings")
        .select("last_seen_at")
        .gte("last_seen_at", sinceIso)
        .limit(20000)
        .then(ok, bad("cross_platform_listings")),
      supabase
        .from("show_mentions")
        .select("observed_at")
        .gte("observed_at", sinceIso)
        .limit(20000)
        .then(ok, bad("show_mentions")),
      supabase
        .from("listing_images")
        .select("uploaded_at, uploaded_by")
        .gte("uploaded_at", sinceIso)
        .limit(20000)
        .then(ok, bad("listing_images")),
      supabase
        .from("alerts")
        .select("created_at, owner_id")
        .gte("created_at", sinceIso)
        .limit(20000)
        .then(ok, bad("alerts")),
      supabase
        .from("user_events")
        .select("id, event_name, user_email, page, session_id, source, properties, created_date")
        .gte("created_date", sinceIso)
        .order("created_date", { ascending: false })
        .limit(20000)
        .then(ok, bad("user_events")),
    ]);

    const bundle: DataBundle = {
      period,
      fetchedAt: new Date().toISOString(),
      profiles: (profilesRes as Profile[]).map((p) => ({
        ...p,
        role: (p.role as "user" | "admin") ?? "user",
      })),
      newListings: (listingsRes as Array<{ first_seen_at: string | null }>).map((r) => ({
        t: r.first_seen_at ?? "",
      })),
      priceDrops: (dropsRes as Array<{ observed_at: string | null }>).map((r) => ({
        t: r.observed_at ?? "",
      })),
      sold: (soldRes as Array<{ observed_at: string | null }>).map((r) => ({
        t: r.observed_at ?? "",
      })),
      crossPlatform: (crossRes as Array<{ last_seen_at: string | null }>).map((r) => ({
        t: r.last_seen_at ?? "",
      })),
      showMentions: (showsRes as Array<{ observed_at: string | null }>).map((r) => ({
        t: r.observed_at ?? "",
      })),
      listingImages: (imagesRes as Array<{ uploaded_at: string | null; uploaded_by: string | null }>).map(
        (r) => ({ t: r.uploaded_at ?? "", uploaded_by: r.uploaded_by }),
      ),
      alerts: (alertsRes as Array<{ created_at: string | null; owner_id: string | null }>).map((r) => ({
        t: r.created_at ?? "",
        owner_id: r.owner_id,
      })),
      events: eventsRes as UserEvent[],
    };

    setData(bundle);
    setLoading(false);
  }, [period]);

  useEffect(() => {
    void fetchAll();
    // We intentionally don't re-fetch on period change — aggregation is
    // client-side from a single 2×MAX_PERIOD window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scan for any partial errors surfaced by `bad()`.
  useEffect(() => {
    const err = (window as unknown as { __geckAnalyticsError?: string }).__geckAnalyticsError;
    if (err) setError(err);
  }, [data]);

  const totalUsers = data?.profiles.length ?? 0;
  const oldestAccountDays = useMemo(() => {
    if (!data || data.profiles.length === 0) return null;
    const oldest = data.profiles
      .map((p) => Date.parse(p.created_at))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)[0];
    if (!oldest) return null;
    return Math.floor((Date.now() - oldest) / DAY_MS);
  }, [data]);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Admin · Growth & Usage"
        title="Analytics"
        description={
          totalUsers > 0
            ? `${totalUsers.toLocaleString()} total users${
                oldestAccountDays != null
                  ? ` · oldest account ${oldestAccountDays} days old`
                  : ""
              }`
            : "No users yet. Sanity-anchor subtitle will appear once signups arrive."
        }
        right={
          <div className="flex items-center gap-3">
            <PeriodSelector value={period} onChange={setPeriod} />
            <button
              type="button"
              onClick={() => void fetchAll()}
              disabled={loading}
              className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-ink-200 hover:border-ink-600 hover:text-ink-50 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-400">
        <StatusPill
          status={loading ? "busy" : error ? "idle" : "ready"}
          label={loading ? "Loading" : error ? "Partial" : "Live"}
        />
        {data ? (
          <span className="font-mono">Fetched {fmtRelative(data.fetchedAt)}</span>
        ) : null}
        {error ? (
          <span className="font-mono text-danger">{error}</span>
        ) : null}
      </div>

      <TabBar tab={tab} onChange={setTab} />

      {tab === "growth" && <GrowthTab data={data} period={period} />}
      {tab === "engagement" && <EngagementTab data={data} period={period} />}
      {tab === "features" && <FeaturesTab data={data} period={period} />}
      {tab === "retention" && <RetentionTab data={data} />}
      {tab === "errors" && <ErrorLogsViewer />}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Supabase response adapters
// ----------------------------------------------------------------------------
function ok<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return (r.data ?? []) as T;
}

function bad(label: string) {
  return (e: unknown) => {
    console.warn(`[analytics] ${label} fetch failed`, e);
    (window as unknown as { __geckAnalyticsError?: string }).__geckAnalyticsError =
      `Some tables failed to load (e.g. ${label}). Check that the 0003 migration has run.`;
    return [] as never;
  };
}

// ----------------------------------------------------------------------------
// PeriodSelector / TabBar — small presentational bits.
// ----------------------------------------------------------------------------
function PeriodSelector({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-ink-700 bg-ink-850 font-mono text-[11px]">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`px-2.5 py-1.5 transition ${
            value === p
              ? "bg-ink-700 text-ink-50"
              : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"
          }`}
        >
          {p}d
        </button>
      ))}
    </div>
  );
}

function TabBar({
  tab,
  onChange,
}: {
  tab: TabKey;
  onChange: (t: TabKey) => void;
}) {
  return (
    <div className="border-b border-ink-700/70">
      <div className="-mb-px flex flex-wrap gap-1">
        {TABS.map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChange(t)}
              className={`border-b-2 px-3 py-2 text-sm capitalize transition ${
                active
                  ? "border-claude text-ink-50"
                  : "border-transparent text-ink-400 hover:text-ink-100"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}
