-- =============================================================================
-- MIGRATION 003: Add client_id to campaigns table
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY: campaigns only had user_id, preventing per-brand (client) filtering
-- on the dashboard. ad_accounts already had client_id; this aligns campaigns.
--
-- SAFE: column is nullable so existing inserts without client_id still work.
-- =============================================================================

-- 1. Add client_id column
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

-- 2. Backfill: assign existing campaigns to each user's "Default" client
--    Falls back to the earliest-created client if no "Default" exists.
UPDATE public.campaigns c
SET client_id = (
  SELECT cl.id
  FROM public.clients cl
  WHERE cl.user_id = c.user_id
  ORDER BY (cl.name = 'Default') DESC, cl.created_at ASC
  LIMIT 1
)
WHERE c.client_id IS NULL;

-- 3. Create index for query performance on dashboard endpoints
CREATE INDEX IF NOT EXISTS idx_campaigns_user_client
  ON public.campaigns(user_id, client_id);

-- =============================================================================
-- Verification: run this SELECT after applying to confirm results
-- SELECT id, user_id, client_id FROM public.campaigns LIMIT 10;
-- =============================================================================
