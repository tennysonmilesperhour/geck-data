// /listings, /sellers and /design-lab show single third-party listings, their
// photos and their sellers, so they are for signed-in members only
// (13 Oct 2026). Aggregate pages (/, /morphs, /trends, /markets) stay public.
const PROTECTED_PAGE_PREFIXES = [
  "/upload",
  "/admin",
  "/data-admin",
  "/listings",
  "/sellers",
  "/design-lab",
];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
