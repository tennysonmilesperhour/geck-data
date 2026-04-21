"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  // useSearchParams() forces client-side rendering; Next requires a Suspense
  // boundary around it during static export of this page.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/upload";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
    router.push(next);
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="mb-6 text-2xl font-semibold text-ink-50">
        {mode === "signin" ? "Log in" : "Create account"}
      </h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-200">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-ink-100 placeholder-ink-500"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-200">Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-ink-100 placeholder-ink-500"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </div>

        {error && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-claude py-2 text-ink-50 shadow-glow hover:bg-claude-glow disabled:opacity-50"
        >
          {loading
            ? "Working…"
            : mode === "signin"
              ? "Log in"
              : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-sm text-ink-400">
        {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="text-claude underline hover:text-claude-glow"
        >
          {mode === "signin" ? "Create one" : "Log in"}
        </button>
      </p>
    </div>
  );
}
