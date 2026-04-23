-- =============================================================================
-- MIGRATION 007: optimization_runs + optimization_recommendations
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY: Cada analisis IA se persiste para: (a) cache por input_hash, (b) auditoria,
--      (c) mostrar historial al cliente, (d) entrenar futuros benchmarks.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.optimization_runs (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id         UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  input_hash          TEXT        NOT NULL,
  prompt_version      TEXT        NOT NULL,
  model               TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','failed','insufficient_data')),
  raw_input           JSONB,
  raw_output          JSONB,
  summary             JSONB,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  latency_ms          INTEGER,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_optimization_runs_campaign
  ON public.optimization_runs(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_user
  ON public.optimization_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_cache
  ON public.optimization_runs(campaign_id, input_hash, created_at DESC);

ALTER TABLE public.optimization_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own optimization runs" ON public.optimization_runs;
CREATE POLICY "Users read own optimization runs"
  ON public.optimization_runs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.optimization_recommendations (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id               UUID        NOT NULL REFERENCES public.optimization_runs(id) ON DELETE CASCADE,
  campaign_id          UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id          TEXT        NOT NULL,
  action_type          TEXT        NOT NULL
    CHECK (action_type IN (
      'pause_campaign','resume_campaign','adjust_budget',
      'flag_for_review','informational'
    )),
  priority             TEXT        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high','medium','low')),
  title                TEXT        NOT NULL,
  rationale            TEXT,
  expected_impact      TEXT,
  params               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  requires_confirmation BOOLEAN    NOT NULL DEFAULT TRUE,
  confidence           NUMERIC,
  applicable_to_platform BOOLEAN   NOT NULL DEFAULT TRUE,
  platform_support     TEXT        NOT NULL DEFAULT 'automatic'
    CHECK (platform_support IN ('automatic','manual_required','unsupported')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_campaign
  ON public.optimization_recommendations(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_run
  ON public.optimization_recommendations(run_id);

ALTER TABLE public.optimization_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own recommendations" ON public.optimization_recommendations;
CREATE POLICY "Users read own recommendations"
  ON public.optimization_recommendations
  FOR SELECT
  USING (auth.uid() = user_id);

-- =============================================================================
-- Verification:
--   SELECT * FROM public.optimization_runs ORDER BY created_at DESC LIMIT 5;
--   SELECT * FROM public.optimization_recommendations ORDER BY created_at DESC LIMIT 5;
-- =============================================================================
