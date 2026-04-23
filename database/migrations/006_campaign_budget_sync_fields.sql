-- =============================================================================
-- MIGRATION 006: campaign dual budget + sync status fields
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY: Manejar doble fuente de verdad para presupuesto (local vs plataforma),
--      detectar drift y permitir que el frontend muestre alertas.
-- =============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS budget_local_daily        NUMERIC,
  ADD COLUMN IF NOT EXISTS budget_local_lifetime     NUMERIC,
  ADD COLUMN IF NOT EXISTS budget_platform_daily     NUMERIC,
  ADD COLUMN IF NOT EXISTS budget_platform_lifetime  NUMERIC,
  ADD COLUMN IF NOT EXISTS budget_source_of_truth    TEXT
    DEFAULT 'platform'
    CHECK (budget_source_of_truth IN ('local', 'platform')),
  ADD COLUMN IF NOT EXISTS budget_sync_status        TEXT
    DEFAULT 'unknown'
    CHECK (budget_sync_status IN ('unknown', 'in_sync', 'drifted', 'error')),
  ADD COLUMN IF NOT EXISTS budget_last_synced_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS budget_drift_pct          NUMERIC,
  ADD COLUMN IF NOT EXISTS spend_platform            NUMERIC,
  ADD COLUMN IF NOT EXISTS spend_last_synced_at      TIMESTAMPTZ;

-- Backfill budget_local_daily from legacy budget_usd
UPDATE public.campaigns
SET budget_local_daily = budget_usd
WHERE budget_local_daily IS NULL AND budget_usd IS NOT NULL;

-- Backfill budget_local_lifetime from legacy lifetime_budget
UPDATE public.campaigns
SET budget_local_lifetime = lifetime_budget
WHERE budget_local_lifetime IS NULL AND lifetime_budget IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_budget_sync_status
  ON public.campaigns(budget_sync_status);

-- =============================================================================
-- Verification:
--   SELECT id, budget_local_daily, budget_platform_daily, budget_sync_status
--   FROM public.campaigns LIMIT 5;
-- =============================================================================
