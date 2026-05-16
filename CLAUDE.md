# Geck Data: Claude Code Instructions

## Direct-to-main workflow

The user's standing instruction: **commit and push directly to `main`. No
PRs, no preview review, no waiting.** Every push to main triggers a
production Vercel deploy, and that's intentional.

Default flow for every change:

1. Make the edit on a local working copy of `main`.
2. Run `tsc --noEmit` and any relevant smoke checks.
3. `git add` the specific files (never `git add -A` / `git add .`).
4. Commit with a descriptive message.
5. `git push origin main`.
6. Watch the production Vercel deploy via `vercel ls` or
   `vercel inspect <url> --logs` if it fails. Fix forward; do not roll
   back unless the user explicitly asks.

Do **not** open PRs unless the user explicitly requests one. The
review/preview ceremony was removed because the user wants speed over
gatekeeping and is comfortable with main = prod.

The exception is destructive or irreversible changes (history rewrites,
schema drops, mass deletes of production rows, secret rotation). For
those, ask first.

## Before pushing to main, always

- Run `tsc --noEmit --pretty false` and confirm clean. A type error in
  `main` immediately breaks the Vercel production build.
- Keep commits small and focused — one logical change per commit makes
  `git revert` straightforward if a push needs to be backed out.
- Never push files outside the change scope: `.env`, secrets, large
  binaries, or untracked work-in-progress should be excluded by adding
  files individually rather than `git add -A`.

## Production state, treat with care

This repo's `main` branch deploys directly to
`https://geck-data.vercel.app` (production). The Supabase project it
talks to is the live one used by the Eye in the Sky extension and the
Geck Inspect web app. Schema migrations land in `supabase/migrations/`.
Apply them directly via the Supabase MCP (`mcp__supabase__apply_migration`
for DDL, or `execute_sql` for idempotent `CREATE OR REPLACE` and data
backfills) at the same time you push the migration file to main, so the
schema state in prod always matches what `main` expects. Flag any DDL
that drops or rewrites existing data; ask the user before running it.

## Companion repos

- `tennysonmilesperhour/eyeinthesky`: the Chrome extension that POSTs
  marketplace events to `/api/ingest` here.
- `tennysonmilesperhour/geck-inspect`: the web app that reads from
  this project's Supabase via `/data/market.json` and direct queries
  to `external_reference_images`, `morph_taxonomy`, `listing_images`,
  etc.

## Species scope

Geck Inspect is crested-gecko-first. The extension scrapes whatever
MorphMarket page the user views, so non-crested listings arrive in
the same stream. Migration 0010 added `species` columns and an
`archive-listing-images` bucket: crested data lands in the public
`listing-images` bucket and surfaces in `/data/market.json`;
everything else is preserved with a species tag and archived. Do not
broaden the read paths to surface non-crested data without an explicit
ask.
