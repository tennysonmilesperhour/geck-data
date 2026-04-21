# Admin Analytics migration

File: `0003_admin_analytics.sql`

## What it creates

- **`profiles`** — `(id, email, role in {user, admin}, created_at, updated_at)`.
  Mirrors `auth.users` 1:1 via a trigger; backfills on migration. Role defaults
  to `user`; promote manually (see below).
- **`user_events`** — append-only product telemetry.
  Columns: `event_name, user_email, page, session_id, source, properties jsonb,
  created_by, created_date`. `source` lets us tell `geck-inspect` web traffic
  apart from the extension, the scraper, or future inspectors that write to the
  same table via the Supabase REST API.
- **`error_logs`** — frontend error capture.
  Columns: `level in {error, warning, info}, message, stack, url, user_email,
  user_agent, source, context jsonb, resolved, resolved_by, resolved_date,
  created_by, created_date`.
- **`v_daily_activity`** — 90-day view: `day, active_users, event_count`.
  Drives the DAU chart on the Engagement tab.
- **`is_admin()`** — `stable` SQL function used by every admin RLS policy.

## Indexes

- `user_events`: `created_date desc`, `(event_name, created_date)`,
  `(user_email, created_date)`, `(page, created_date)`,
  `(source, created_date)`, `(session_id)`.
- `error_logs`: `created_date desc`, `(resolved, created_date)`, `(user_email)`,
  `(source, created_date)`.
- `profiles`: `role`.

## RLS

| table | INSERT | SELECT/UPDATE/DELETE |
|---|---|---|
| `user_events` | anyone (anon + authed) | admins only |
| `error_logs`  | anyone (anon + authed) | admins only |
| `profiles`    | via trigger only       | owner reads own row; admins read/update any |

Anyone can insert so the web app, the extension, and third-party sources can
all post telemetry with the anon key without a server round trip. Nobody
(except admins) can read the tables back.

## Bootstrap your first admin

After running the migration, in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where email = 'you@example.com';
```

That unlocks `/admin/analytics`. Every subsequent signup gets `role = 'user'`
by default; promote more admins the same way.

## Scaling note

Client-side aggregation on the dashboard caps at 20k events per tab fetch
(matches the pattern from the source app). Once real usage lands and `user_events`
grows past a few hundred thousand rows, move the heavy aggregations into SQL:
the Growth tab can build on existing market-event tables, and the Retention
grid should become a `cohort_retention` RPC rather than a client-side bucketing
pass.
