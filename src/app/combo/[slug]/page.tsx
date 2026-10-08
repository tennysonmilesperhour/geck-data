// Old combo pages ("lilly-white__cappuccino") now open the price check
// with both morphs selected.
import { redirect } from "next/navigation";

export default async function ComboRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parts = decodeURIComponent(slug)
    .split("__")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]+$/.test(s));
  redirect(parts.length ? `/?t=${parts.join(",")}` : "/morphs");
}
