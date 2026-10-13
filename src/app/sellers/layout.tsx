import type { ReactNode } from "react";
import MembersGate from "@/components/auth/MembersGate";

// Members only (13 Oct 2026): see src/lib/auth/protected-routes.ts.
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: ReactNode }) {
  return <MembersGate path="/sellers">{children}</MembersGate>;
}
