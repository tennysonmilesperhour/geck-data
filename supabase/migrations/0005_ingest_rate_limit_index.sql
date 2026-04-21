-- ============================================================================
-- Geck Inspect — 0005: ingest rate-limit index
--
-- The POST /api/ingest handler consults ingest_audit to enforce a per-
-- client-IP-hash rate limit (see src/lib/ingest/rateLimit.ts). That check
-- runs two COUNT(*) queries with predicate
--   client_ip_hash = ? AND received_at >= ?
-- on every inbound POST. Without a matching index, Postgres would walk
-- the received_at index and filter client_ip_hash inline, which gets
-- slower linearly with ingest volume.
--
-- Adding a composite index on (client_ip_hash, received_at desc) keeps
-- the rate-limit lookup O(recent_rows_for_this_ip), which is what we
-- want.
--
-- Safe to re-run.
-- ============================================================================

create index if not exists idx_ingest_audit_ip_received
  on public.ingest_audit(client_ip_hash, received_at desc);
