# Geck Data: Claude Code Instructions

## Auto-merge policy

When the user asks for a change in this repo, the default flow is:

1. Open the PR (draft is fine if CI runs on PRs).
2. Wait for required checks. The only required check today is the Vercel
   preview deployment.
3. Once checks are green, **mark the PR ready for review and merge it
   into `main` without waiting for an explicit "go ahead"**. Use
   `mcp__github__merge_pull_request` with `merge_method: 'squash'`
   unless the user specified otherwise.
4. If CI fails, investigate and fix in the same PR. Only escalate to
   the user when the failure is ambiguous or architecturally significant.

The user's standing instruction is: never make them be the one to
merge. Don't ask "do you want me to merge?" once the PR is green;
just merge it.

The exception is destructive or irreversible changes (history
rewrites, schema drops, mass deletes of production rows). For those,
ask first.

## Production state, treat with care

This repo's `main` branch deploys directly to
`https://geck-data.vercel.app` (production). The Supabase project it
talks to is the live one used by the Eye in the Sky extension and the
Geck Inspect web app. Schema migrations land in `supabase/migrations/`
but are not auto-applied; the user runs them by hand in Supabase SQL
Editor after merge. Flag this when you ship a migration so the user
remembers to apply it.

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
