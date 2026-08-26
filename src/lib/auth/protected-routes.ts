const PROTECTED_PAGE_PREFIXES = ["/upload", "/admin", "/data-admin"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
