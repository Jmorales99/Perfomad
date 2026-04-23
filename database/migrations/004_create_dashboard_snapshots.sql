-- =============================================================================
-- MIGRATION 004: Create dashboard_snapshots table
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY: The dashboard now shows real data from connected ad platforms (Meta,
--      Google Ads). Fetching APIs on every page load is slow and burns rate
--      limits. This table caches the last sync per ad account so the page
--      loads instantly from DB. Refreshed manually via the "Actualizar" button.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.dashboard_snapshots (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID          NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  client_id       UUID          NOT NULL REFERENCES public.clients(id)   ON DELETE CASCADE,
  platform        TEXT          NOT NULL,
  ad_account_id   UUID          NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  account_metrics JSONB         NOT NULL DEFAULT '{}',
  platform_campaigns JSONB      NOT NULL DEFAULT '[]',
  synced_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  date_range_since DATE,
  date_range_until DATE,
  UNIQUE (user_id, client_id, ad_account_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_user_client
  ON public.dashboard_snapshots(user_id, client_id);

-- Row-level security: users can only read/write their own snapshots
ALTER TABLE public.dashboard_snapshots ENABLE ROW LEVEL SECURITY;

-- PostgreSQL does not support IF NOT EXISTS on CREATE POLICY on Supabase's Postgres version
DROP POLICY IF EXISTS "Users manage own snapshots" ON public.dashboard_snapshots;

CREATE POLICY "Users manage own snapshots"
  ON public.dashboard_snapshots
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- Verification:
--   SELECT * FROM public.dashboard_snapshots LIMIT 5;
-- =============================================================================
