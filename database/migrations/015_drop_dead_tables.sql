-- =============================================================================
-- MIGRATION 015: Drop dead tables and unused columns
--
-- WHY: After comparing the real Supabase schema against code references,
--      these objects have zero usage in any repository, use case, or controller.
--      Keeping them creates confusion and wastes storage.
--
-- SAFE: All three tables are completely disconnected from active code paths.
--       Columns being dropped have no references in src/.
-- =============================================================================

-- 1. platform_campaign_metrics_history must go first (FK → platform_campaigns)
DROP TABLE IF EXISTS public.platform_campaign_metrics_history;

-- 2. platform_campaigns: was a separate entity for platform campaigns,
--    replaced by campaigns.platform_campaign_id (JSONB) + dashboard_snapshots
DROP TABLE IF EXISTS public.platform_campaigns;

-- 3. sync_logs: logging was moved to Fastify req.log + campaigns.sync_status
DROP TABLE IF EXISTS public.sync_logs;

-- 4. ad_accounts orphan columns (confirmed zero code references via grep)
ALTER TABLE public.ad_accounts
  DROP COLUMN IF EXISTS last_synced_campaigns_at,
  DROP COLUMN IF EXISTS sync_enabled;

-- =============================================================================
-- Verification:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('platform_campaigns','platform_campaign_metrics_history','sync_logs');
--   -- Should return 0 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'ad_accounts'
--     AND column_name IN ('last_synced_campaigns_at','sync_enabled');
--   -- Should return 0 rows
-- =============================================================================
