import { timingSafeEqual } from "node:crypto";

/** Compare a presented API token against one or more configured secrets. */
export function matchesApiToken(
  presented: string,
  expectedTokens: Array<string | undefined>,
): boolean {
  if (!presented) return false;
  const candidate = Buffer.from(presented);

  return expectedTokens.some((expected) => {
    if (!expected) return false;
    const configured = Buffer.from(expected);
    return (
      candidate.length === configured.length &&
      timingSafeEqual(candidate, configured)
    );
  });
}
