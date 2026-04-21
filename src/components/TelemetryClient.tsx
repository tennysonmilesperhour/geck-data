"use client";
// Client-only. Mounted once from the root layout so:
//   1) window.error + unhandledrejection feed into public.error_logs
//   2) every route change fires a page_view into public.user_events
//
// Lives as its own component because the root layout is a Server Component
// and can't call useEffect directly.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { installGlobalErrorHandlers, trackPageView } from "@/lib/telemetry";

export default function TelemetryClient() {
  const pathname = usePathname();

  useEffect(() => {
    installGlobalErrorHandlers();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
