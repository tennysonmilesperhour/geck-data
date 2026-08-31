// Sample-size confidence, one curve for every market widget and API.
//
//   score = 100 * log10(n) / log10(SATURATION), and 0 when n <= 0
//
// It is a sample-size statement and nothing else: it does not speak to
// freshness, sold vs ask, or whether two markets are comparable.

const CONFIDENCE_SATURATION_N = 200;

export function sampleConfidence(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const capped = Math.min(n, CONFIDENCE_SATURATION_N);
  return Math.round(
    (Math.log10(capped) / Math.log10(CONFIDENCE_SATURATION_N)) * 100,
  );
}
