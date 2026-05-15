-- Per-seller metadata captured from MorphMarket's per-store page.
-- Populated weekly by scripts/scrape_sellers.py.

CREATE TABLE IF NOT EXISTS public.sellers (
    seller_slug      text PRIMARY KEY,    -- URL slug, e.g. "rosethornexotics"
    store_name       text,                -- display name from <title>
    owner_name       text,                -- parsed from meta description
    location_raw     text,                -- "Atlanta, GA, USA" — raw, unsplit
    member_since     text,                -- "Basic Member since 2025"
    listings_count   int,                 -- self-reported active listings
    avatar_url       text,
    first_seen_at    timestamptz NOT NULL DEFAULT NOW(),
    last_updated_at  timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read sellers" ON public.sellers;
CREATE POLICY "public read sellers"
    ON public.sellers FOR SELECT
    TO public
    USING (true);

-- Per-listing pointer to the seller's slug, populated by scrape_details.py
-- when it parses each listing's detail page.
ALTER TABLE public.listings
    ADD COLUMN IF NOT EXISTS seller_slug text;

CREATE INDEX IF NOT EXISTS idx_listings_seller_slug
    ON public.listings (seller_slug)
    WHERE seller_slug IS NOT NULL;

-- Returns slugs that need a (re)scrape: never seen, or last-scraped > 7d ago.
-- Mirrors listings_needing_detail_scrape's "fresh-or-stale" shape.
CREATE OR REPLACE VIEW public.sellers_needing_scrape AS
SELECT DISTINCT l.seller_slug
FROM public.listings l
LEFT JOIN public.sellers s ON s.seller_slug = l.seller_slug
WHERE l.seller_slug IS NOT NULL
  AND l.is_active = TRUE
  AND (s.seller_slug IS NULL OR s.last_updated_at < NOW() - INTERVAL '7 days');
