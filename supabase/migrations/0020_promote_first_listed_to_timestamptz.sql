-- 0020_promote_first_listed_to_timestamptz.sql
--
-- Promote the historical text-typed `first_listed` column (YYYY-MM-DD)
-- into the typed `first_listed_at` timestamptz column. This unlocks
-- chronological trend queries by *MorphMarket listing date* — the date
-- the listing actually appeared on the marketplace — rather than the
-- date our scraper first observed it.
--
-- Why this matters: the catalog scraper bootstrapped over a 3-day
-- window in May 2026, so `first_seen_at` reflects scrape calendar, not
-- market calendar. The `first_listed` text column was populated for
-- ~1,105 rows (16% of the catalog) by an earlier import path and
-- carries real listing dates back to 2023-02-25. Using these dates
-- gives the /trends page a true 3-year longitudinal view for those
-- rows; the rest fall back to first_seen_at via coalesce in queries.
--
-- Idempotent: only fills first_listed_at where it is currently NULL.

update public.market_listings
set first_listed_at = (first_listed || ' 00:00:00+00')::timestamptz
where first_listed_at is null
  and first_listed ~ '^\d{4}-\d{2}-\d{2}$';
