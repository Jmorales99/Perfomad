-- =============================================================================
-- MIGRATION 005: optimization_config (global feature flags + thresholds)
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY: Centraliza los umbrales y flags usados por el pipeline de optimizacion
--      IA para poder ajustarlos sin redeploy. Una sola fila por defecto.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.optimization_config (
  id                              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Feature flags
  mvp_actions_enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  auto_apply_policy               TEXT        NOT NULL DEFAULT 'off'
    CHECK (auto_apply_policy IN ('off', 'low_risk', 'all')),
  -- Thresholds
  budget_drift_threshold_pct      NUMERIC     NOT NULL DEFAULT 5.0,
  analysis_cache_ttl_hours        INTEGER     NOT NULL DEFAULT 12,
  max_budget_adjust_pct           NUMERIC     NOT NULL DEFAULT 25.0,
  min_days_before_action          INTEGER     NOT NULL DEFAULT 3,
  min_spend_before_action         NUMERIC     NOT NULL DEFAULT 20.0,
  analyze_rate_limit_per_hour     INTEGER     NOT NULL DEFAULT 10,
  -- LLM
  llm_model                       TEXT        NOT NULL DEFAULT 'claude-sonnet-4-5',
  llm_max_tokens                  INTEGER     NOT NULL DEFAULT 2000,
  prompt_version                  TEXT        NOT NULL DEFAULT 'v1',
  -- Allowed actions (whitelist for apply)
  allowed_actions                 JSONB       NOT NULL DEFAULT
    '["pause_campaign","resume_campaign","adjust_budget","flag_for_review"]'::jsonb,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the default row if empty
INSERT INTO public.optimization_config (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.optimization_config);

-- Only admins should change these; regular users only read through the backend.
ALTER TABLE public.optimization_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to optimization_config" ON public.optimization_config;
CREATE POLICY "No direct access to optimization_config"
  ON public.optimization_config
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- =============================================================================
-- Verification:
--   SELECT * FROM public.optimization_config;
-- =============================================================================
