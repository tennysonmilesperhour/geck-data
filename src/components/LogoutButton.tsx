"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/");
  }
  return (
    <button
      onClick={logout}
      className="text-ink-400 hover:text-claude"
      type="button"
    >
      Log out
    </button>
  );
}
