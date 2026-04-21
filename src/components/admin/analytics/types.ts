// Shared types for the admin analytics dashboard. Keeps tab components
// honest about the shape of the data they consume; the fetch happens once
// in AnalyticsDashboard.tsx and the result is threaded down as `DataBundle`.

export type Period = 7 | 30 | 90 | 365;

export type Profile = {
  id: string;
  email: string | null;
  role: "user" | "admin";
  created_at: string;
};

export type TimestampedRow = { t: string };

export type UserEvent = {
  id: string;
  event_name: string;
  user_email: string | null;
  page: string | null;
  session_id: string | null;
  source: string | null;
  properties: Record<string, unknown> | null;
  created_date: string;
};

export type DataBundle = {
  period: Period;
  fetchedAt: string;
  profiles: Profile[];
  // All the market-side streams, narrowed to just their timestamp columns —
  // we only need them for counting and bucketing in the dashboard.
  newListings: TimestampedRow[];
  priceDrops: TimestampedRow[];
  sold: TimestampedRow[];
  crossPlatform: TimestampedRow[];
  showMentions: TimestampedRow[];
  listingImages: Array<TimestampedRow & { uploaded_by: string | null }>;
  alerts: Array<TimestampedRow & { owner_id: string | null }>;
  // user_events is loaded across 2×period (capped at ~20k) so we can compute
  // prior-period deltas + retention cohorts without a second fetch.
  events: UserEvent[];
};

export type Delta = {
  curr: number;
  prev: number;
  pct: number; // integer percent
};
