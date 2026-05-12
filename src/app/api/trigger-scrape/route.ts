// POST /api/trigger-scrape
//
// Body: { "workflow": "scrape-listings-daily.yml" }
//
// Verifies the caller is the configured admin (ADMIN_USER_ID) then
// dispatches a workflow_dispatch event to GitHub Actions. The actual
// scrape runs on the GH runner, not here.
//
// Required env vars:
//   ADMIN_USER_ID  Tennyson's Supabase Auth user id
//   GITHUB_PAT     fine-grained PAT with actions:write on the repo
//   GITHUB_REPO    e.g. "tennysonmilesperhour/geck-data"

import { createClient } from "@/lib/supabase/server";

const ALLOWED_WORKFLOWS = new Set([
  "scrape-listings-daily.yml",
  "scrape-details-weekly.yml",
  "scrape-images-weekly.yml",
]);

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

  let body: { workflow?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const workflow = body.workflow ?? "";
  if (!ALLOWED_WORKFLOWS.has(workflow)) {
    return Response.json(
      {
        error: `workflow must be one of: ${Array.from(ALLOWED_WORKFLOWS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;
  if (!pat || !repo) {
    return Response.json(
      { error: "GITHUB_PAT or GITHUB_REPO env var not set" },
      { status: 500 },
    );
  }

  const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
  const ghRes = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (!ghRes.ok) {
    const message = await ghRes.text().catch(() => "");
    return Response.json(
      {
        error: `GitHub returned ${ghRes.status}`,
        details: message.slice(0, 500),
      },
      { status: 502 },
    );
  }

  return Response.json({ success: true, workflow });
}
