// /admin/analytics — admin-only growth, usage, retention, and error analytics.
// Admin gating + cookie/session refresh happens in:
//   1) src/middleware.ts (logged-in check)
//   2) src/app/admin/layout.tsx (admin role check via profiles.role)
//
// This page is a thin server-component shell that renders the client
// AnalyticsDashboard, which does its own fetch via the browser anon client.
// We intentionally don't pre-fetch on the server: RLS on user_events and
// error_logs is admin-only (enforced in 0003_admin_analytics.sql), so the
// session cookie that the client carries is what authorizes the reads.
import AnalyticsDashboard from "@/components/admin/AnalyticsDashboard";

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
