"use client";

import { usePathname } from "next/navigation";

/**
 * The Sold page carries a more precise, source-specific archive notice. Hide
 * the site-wide listings-coverage banner there so two different evidence
 * warnings do not read like duplicate outage alerts.
 */
export default function FreshnessBannerView({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/sold" || pathname.startsWith("/sold/")) return null;

  return (
    <div className={className} role="status">
      {children}
    </div>
  );
}
