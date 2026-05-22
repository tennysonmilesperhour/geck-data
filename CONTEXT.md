# Context

## What this project is

`geck-data` is the data + UI repo behind **Geck Intellect**, the market
intelligence layer of the Geck Inspect product. It is a Next.js 14 App
Router app deployed to Vercel, backed by a single Supabase project
(Postgres, Auth, Storage). It reads a stream of crested gecko market
events captured by the Eye in the Sky Chrome extension from MorphMarket
(and a smaller set of cross-platform sources), and renders pages for
breeders, traders, and hobbyists to follow the market.

The code lives across two product surfaces that share the same Supabase
project:

- This repo (`geck-data`): public Geck Intellect site, an admin
  pipeline (`/data-admin`), and a small operator dashboard
  (`/admin/analytics`). Currently deployed to
  `https://geck-data.vercel.app`. The spec for this work refers to the
  product as live at `geckintellect.geckinspect.com`. Treat both URLs
  as one production deployment (custom domain on top of the Vercel
  project). Both block unauthenticated `WebFetch` from this session.
- `tennysonmilesperhour/geck-inspect`: the morph classifier web app.
  Reads from the same Supabase via `/data/market.json` and direct
  queries to a handful of shared tables.

## Who it is for

- **Breeders** evaluating production roadmaps: which combos are scarce,
  which are oversupplied, where the median price is moving.
- **Traders / collectors** running price comparisons before they buy,
  bid, or list.
- **Tennyson** himself, both as operator and power user. He is the
  primary stakeholder for the spec this branch implements.

The product analogs cited in the spec are Card Ladder (sports cards),
Zillow / Redfin (housing), and StockX (sneakers). The interaction goal
is Level 2: filters and entity pages compose, no dead ends, every
number traceable to a source.

## Where the data comes from

1. The Eye in the Sky extension POSTs JSON events to `/api/ingest`
   (Bearer auth) as the user browses MorphMarket and other platforms.
2. Python scrapers in `scripts/` (Decodo + Supabase), scheduled by
   GitHub Actions, walk the MorphMarket grid daily, re-scrape details
   weekly, and download primary images weekly.
3. Both paths upsert into the same Supabase tables. The dashboard reads
   live data from views and RPCs on top of those tables.

Crested geckos are the canonical species; non-crested data lands in
`archive-listing-images` and is preserved with a species tag (migration
`0010`). Do not broaden read paths to surface non-crested data without
an explicit ask.

## Current state, May 2026

The site is functional. Every named route in the spec exists. Most
charts render real numbers most of the time. Per-listing and per-seller
entity pages are real. Source attribution, confidence badges, and
empty-state handling are partially in place. `tsc --noEmit` is clean.

What is missing (relative to the spec) is **navigability** and
**composability**: no global filter state, no per-combo / per-trait /
per-region entity pages, the sub-indices card is hardcoded to an
"unavailable" empty state because the underlying SQL view was never
written, the methodology page does not exist, watchlists do not exist,
no view-level CSV export beyond `/api/market/snapshot.csv`, and the
alert pipeline has a notifier file but no email sender wired up.

The full inventory and the gap analysis live in `ARCHITECTURE.md`. The
plan to close those gaps lives in `INTENT.md`. The audit log and the
running record of architectural choices live in `DECISIONS.md`.

## Constraints worth remembering

- Crested-only on read paths (see `species` filter in every market
  view).
- Supabase is shared with two other consumers (Eye in the Sky and
  Geck Inspect classifier app). Schema changes must not break either.
- Direct-to-main is the standing workflow per `CLAUDE.md`, with the
  exception of destructive or planning-gated work. This branch
  (`claude/market-analytics-visualization-zHvqT`) holds the Phase 0
  audit and is gated on Tennyson's approval before any implementation.
- No em dashes anywhere in code, comments, markdown, or UI copy. Use
  regular dashes, commas, parentheses, or rewrite.
- No secrets in repo. The audit did not read `.env`-style files.
