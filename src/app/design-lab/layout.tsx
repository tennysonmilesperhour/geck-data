import type { Metadata } from "next";
import MembersGate from "@/components/auth/MembersGate";

// Members only (13 Oct 2026): the prototypes render real listings and sellers.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Geck Intellect Design Lab: Four Directions",
  description:
    "Four researched visual directions for a more distinctive, editorial Geck Intellect experience.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
  return <MembersGate path="/design-lab">{children}</MembersGate>;
}
