import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Geck Intellect Design Lab — Four Directions",
  description:
    "Four researched visual directions for a more distinctive, editorial Geck Intellect experience.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
