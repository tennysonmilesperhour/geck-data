-- RLS policies use this helper to add admin access to owner-scoped rows.
-- The consolidation hardening revoked it from authenticated callers, which
-- made those policies raise permission denied instead of returning rows.
-- The function only reports whether the current auth.uid() has role=admin.

revoke execute on function geck_data.is_admin() from public, anon;
grant execute on function geck_data.is_admin() to authenticated;
