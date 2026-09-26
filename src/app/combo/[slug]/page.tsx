// Old combo pages ("lilly-white__cappuccino") now open the price check
// with both morphs selected.
import { redirect } from "next/navigation";

export default function ComboRedirect({ params }: { params: { slug: string } }) {
  const parts = decodeURIComponent(params.slug)
    .split("__")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]+$/.test(s));
  redirect(parts.length ? `/?t=${parts.join(",")}` : "/morphs");
}
