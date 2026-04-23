-- =============================================================================
-- MIGRATION 010: Add `source` + GIN index for platform_campaign_id lookups
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY:
--   Workstream 2 lets users "Optimize" campaigns that already exist in Meta
--   or Google Ads (they were created outside Perfomad). ImportPlatformCampaign
--   upserts a row in `campaigns` keyed by platform_campaign_id->>platform.
--
--   - `source` distinguishes campaigns created in Perfomad ('native') from
--     those imported from a platform ('imported'). Used by the UI to hide
--     edit actions that only make sense for native ones.
--   - GIN index accelerates the JSONB subkey query used to check if a
--     platform campaign has already been imported.
--
-- SAFE: column is nullable with default, index is idempotent.
-- =============================================================================

-- 1. Add `source` column
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'native'
    CHECK (source IN ('native', 'imported'));

-- 2. Backfill existing rows to 'native' (they were all created via the app)
UPDATE public.campaigns SET source = 'native' WHERE source IS NULL;

-- 3. GIN index on platform_campaign_id JSONB for subkey lookups
--    Used by: SELECT ... WHERE platform_campaign_id->>'meta' = $1
CREATE INDEX IF NOT EXISTS idx_campaigns_platform_campaign_id
  ON public.campaigns USING gin (platform_campaign_id);

-- =============================================================================
-- Verification:
-- SELECT source, COUNT(*) FROM public.campaigns GROUP BY source;
-- =============================================================================
