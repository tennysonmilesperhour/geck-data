# Geck Inspect ↔ geck-data: morph card price band

This is the integration spec for adding the price-band estimate to Geck
Inspect's morph classifier output. The geck-data side is shipped; this
doc is the contract Geck Inspect's edge function and morph card UI
should follow.

## Endpoint

`GET https://geck-data.vercel.app/api/market/fair-price`

Query parameters (all optional except `combo`):

| Param | Type | Example | Notes |
|---|---|---|---|
| `combo` | string | `lw-axa` | Canonical combo id. Required. Full list under `HIGH_VALUE_COMBOS`. |
| `age` | enum | `adult` | `hatchling`, `juvenile`, `subadult`, `adult`, `proven_breeder`, `unknown` |
| `sex` | enum | `female` | `male`, `female`, `unknown` |
| `weight` | number | `45` | Grams |
| `proven` | bool | `true` | True/false. Distinct from `age=proven_breeder`. |
| `recent_sales` | int | `3` | If > 0, include up to N recent comparable sales |

Or `POST` the same fields plus `traits` (a string array) as JSON if you
have raw trait labels instead of a canonical combo id — the endpoint
runs trait → combo matching for you.

## Response shape

```json
{
  "combo_id": "lw-axa",
  "n": 47,
  "base": { "p10": 250, "p25": 320, "p50": 400, "p75": 550, "p90": 750 },
  "adjusted": { "p10": 345, "p25": 442, "p50": 552, "p75": 759, "p90": 1035 },
  "applied": {
    "age": 1.2,
    "sex": 1.15,
    "proven": 1.0,
    "weight_bucket": 1.0
  },
  "multiplier_total": 1.38,
  "confidence": "high",
  "note": "Based on current MorphMarket sales trends. Actual value varies with the buyer's perception of pattern quality, parentage, and overall condition.",
  "recent_sales": [
    { "listing_id": "mm_…", "sold_usd": 525, "sold_at": "…", "days_to_sell": 18, "seller_name": "…", "source_url": "…" }
  ]
}
```

Empty-state response (combo recognised but no recent sold data):

```json
{
  "combo_id": "lw-axa",
  "n": 0,
  "base": null,
  "adjusted": null,
  "confidence": "low",
  "note": "Based on current MorphMarket sales trends. …",
  "message": "No sold data in the 180-day window for this combo."
}
```

## Inline morph card integration

Pseudo-code for the classifier edge function:

```ts
async function classify(image: Buffer): Promise<MorphResult> {
  const prediction = await callClaude(image);  // existing path

  // NEW: enrich with price band when confidence permits.
  let priceBand = null;
  if (prediction.confidence >= 0.7 && prediction.combo_id) {
    const params = new URLSearchParams({
      combo: prediction.combo_id,
      age: prediction.age ?? "unknown",
      sex: prediction.sex ?? "unknown",
      proven: String(prediction.proven ?? false),
      recent_sales: "3",
    });
    if (prediction.weight_grams) params.set("weight", String(prediction.weight_grams));
    try {
      const r = await fetch(
        `https://geck-data.vercel.app/api/market/fair-price?${params}`,
        { signal: AbortSignal.timeout(2000) }
      );
      if (r.ok) priceBand = await r.json();
    } catch {
      // Best-effort: a slow or down geck-data must not block the morph
      // classifier response. priceBand stays null; UI hides the band.
    }
  }

  return { ...prediction, price_band: priceBand };
}
```

Confidence gate: **don't show a band when classifier confidence < 0.7.**
A wrong combo guess produces a wrong price, which is worse than no
price. Below the threshold, render a "What's it worth?" link that
deep-links to `https://geck-data.vercel.app/whats-it-worth` so the user
can pick the combo manually.

## UI rendering

Render under the morph badge on the gecko card:

```
┌─────────────────────────────────┐
│ Lilly White × Axanthic          │
│ ─────────────────────────────── │
│ Worth: $442–759                 │
│ Midpoint $552 · 47 recent sales │
│                                 │
│ Based on current MorphMarket    │
│ sales trends. Varies with the   │
│ buyer's perception of pattern   │
│ quality, parentage, and overall │
│ condition.                      │
└─────────────────────────────────┘
```

Use the **inter-quartile band** (`p25..p75`) for the headline range —
that's the "typical" zone, not the full extreme p10..p90. Show the
midpoint (`p50`) and `n` for trust. Render the `note` verbatim under
the price.

## What happens if the migration hasn't been applied

The endpoint falls back to in-process multiplier defaults
(`FALLBACK_MULTIPLIERS` in `lib/market/price-adjust.ts`) and still
returns a sensible `adjusted` band. Confidence and sample counts come
from `v_combo_price_distribution`, which is built in 0029. So:

- 0029 applied, 0033 not: works (uses fallback multipliers, source="seed" effectively).
- 0033 applied: works with the seeded multipliers, refreshable via
  `POST /api/training/refresh-adjustments`.

## Refreshing multipliers from real data

```
curl -X POST -H "Authorization: Bearer $INGEST_API_KEY" \
  "https://geck-data.vercel.app/api/training/refresh-adjustments?window_days=180"
```

Wire it up as a weekly Vercel Cron once the production extension stream
has enough sold rows to make the regression meaningful (≥20 samples per
bucket; the endpoint enforces this).
