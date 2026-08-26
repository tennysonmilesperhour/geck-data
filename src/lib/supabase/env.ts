type PublicSupabaseEnv = {
  url: string;
  key: string;
};

// Keep public-key discovery consistent across the browser, Node, and Edge
// clients. Supabase's newer publishable key is preferred, while the legacy
// anon key remains supported during the migration window.
export function getPublicSupabaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): PublicSupabaseEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    env.SUPABASE_ANON_KEY;

  return url && key ? { url, key } : null;
}
