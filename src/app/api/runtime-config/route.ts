// POST /api/runtime-config
//
// Body: { "key": "eval_daily_cap_calls", "value": 500 }
//
// Updates a single runtime_config row. Admin-gated by ADMIN_USER_ID
// (same gate as /api/trigger-scrape and /data-admin/*). Writes audit
// trail via the runtime_config_audit trigger.
//
// Value is parsed against the row's value_kind so the UI can't set an
// integer knob to "foo" or push a number past min/max_value.

import { createClient } from "@/lib/supabase/server";

type Body = { key?: string; value?: unknown };

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }
  if (!process.env.ADMIN_USER_ID || user.id !== process.env.ADMIN_USER_ID) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return Response.json({ error: "key is required" }, { status: 400 });
  }

  const { data: existing, error: readErr } = await supabase
    .from("runtime_config")
    .select("key,value_kind,min_value,max_value")
    .eq("key", key)
    .maybeSingle();
  if (readErr) {
    return Response.json(
      { error: `runtime_config read failed: ${readErr.message}` },
      { status: 500 },
    );
  }
  if (!existing) {
    return Response.json(
      { error: `unknown runtime_config key: ${key}` },
      { status: 404 },
    );
  }

  const coerced = coerceValue(
    body.value,
    existing.value_kind as string,
    existing.min_value as number | null,
    existing.max_value as number | null,
  );
  if ("error" in coerced) {
    return Response.json({ error: coerced.error }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from("runtime_config")
    .update({
      value: coerced.value,
      updated_at: new Date().toISOString(),
      updated_by: user.email ?? user.id,
    })
    .eq("key", key);
  if (updateErr) {
    return Response.json(
      { error: `runtime_config update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  return Response.json({ success: true, key, value: coerced.value });
}

type CoercionResult =
  | { value: number | string | boolean | object | null }
  | { error: string };

function coerceValue(
  raw: unknown,
  kind: string,
  min: number | null,
  max: number | null,
): CoercionResult {
  switch (kind) {
    case "integer": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return { error: `value must be an integer, got ${JSON.stringify(raw)}` };
      }
      if (min !== null && n < min) return { error: `value must be >= ${min}` };
      if (max !== null && n > max) return { error: `value must be <= ${max}` };
      return { value: n };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        return { error: `value must be a number, got ${JSON.stringify(raw)}` };
      }
      if (min !== null && n < min) return { error: `value must be >= ${min}` };
      if (max !== null && n > max) return { error: `value must be <= ${max}` };
      return { value: n };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return { error: `value must be a boolean, got ${JSON.stringify(raw)}` };
    }
    case "string": {
      if (typeof raw === "string") return { value: raw };
      return { error: `value must be a string, got ${JSON.stringify(raw)}` };
    }
    case "json": {
      return { value: (raw ?? null) as object | null };
    }
    default:
      return { error: `unknown value_kind: ${kind}` };
  }
}
