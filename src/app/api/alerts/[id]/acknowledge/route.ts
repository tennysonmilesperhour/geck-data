// Acknowledge or snooze the most recent match on an alert.
//
//   POST /api/alerts/<id>/acknowledge
//     body: { snooze_minutes?: number }
//
// Sets acknowledged_at = now() on the most recent un-acked match for the
// alert, and optionally sets snoozed_until on the alert's match stream
// so subsequent matches don't fan out a notification for the duration.
//
// Auth: the user must own the alert (RLS handles the read; we re-check on
// the server because the write uses the service-role client to bypass RLS
// on alert_matches, which doesn't have owner_id directly).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const alertId = params.id;
  if (!alertId) return NextResponse.json({ error: "missing id" }, { status: 400 });

  // Identify the user via the session-aware server client.
  const supa = createServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Confirm the user owns this alert. RLS on alerts is owner-scoped so this
  // SELECT through the user client is enough to verify ownership.
  const { data: alert } = await supa
    .from("alerts")
    .select("id")
    .eq("id", alertId)
    .maybeSingle();
  if (!alert) {
    return NextResponse.json({ error: "alert not found or not yours" }, { status: 404 });
  }

  let body: { snooze_minutes?: number } = {};
  try {
    if (req.body) body = await req.json();
  } catch {
    /* empty body is OK */
  }
  const snoozeMin = Number(body.snooze_minutes ?? 0);
  const snoozedUntil =
    snoozeMin > 0
      ? new Date(Date.now() + snoozeMin * 60_000).toISOString()
      : null;

  // Write with the service-role client. alert_matches has no owner column;
  // we just verified ownership via the user client above.
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("alert_matches")
    .update({
      acknowledged_at: new Date().toISOString(),
      snoozed_until: snoozedUntil,
    })
    .eq("alert_id", alertId)
    .is("acknowledged_at", null)
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    acknowledged: updated?.length ?? 0,
    snoozed_until: snoozedUntil,
  });
}
