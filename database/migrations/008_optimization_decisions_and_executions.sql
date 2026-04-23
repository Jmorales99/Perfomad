-- =============================================================================
-- MIGRATION 008: optimization_decisions + optimization_executions
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY: Registrar que decisiones tomo el usuario (accept/reject) por recomendacion
--      y separar la ejecucion real contra la plataforma, con idempotencia.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.optimization_decisions (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  recommendation_id    UUID        NOT NULL REFERENCES public.optimization_recommendations(id) ON DELETE CASCADE,
  campaign_id          UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision             TEXT        NOT NULL
    CHECK (decision IN ('accept','reject','defer')),
  override_params      JSONB,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recommendation_id)
);

CREATE INDEX IF NOT EXISTS idx_optimization_decisions_campaign
  ON public.optimization_decisions(campaign_id, created_at DESC);

ALTER TABLE public.optimization_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own decisions" ON public.optimization_decisions;
CREATE POLICY "Users read own decisions"
  ON public.optimization_decisions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.optimization_executions (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  decision_id          UUID        NOT NULL REFERENCES public.optimization_decisions(id) ON DELETE CASCADE,
  recommendation_id    UUID        NOT NULL REFERENCES public.optimization_recommendations(id) ON DELETE CASCADE,
  campaign_id          UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform             TEXT        NOT NULL,
  action_type          TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','failed','manual_required','unsupported','skipped')),
  execution_key        TEXT        NOT NULL,
  request_payload      JSONB,
  response_payload     JSONB,
  error_message        TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  UNIQUE (execution_key)
);

CREATE INDEX IF NOT EXISTS idx_optimization_executions_campaign
  ON public.optimization_executions(campaign_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_executions_recommendation
  ON public.optimization_executions(recommendation_id);

ALTER TABLE public.optimization_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own executions" ON public.optimization_executions;
CREATE POLICY "Users read own executions"
  ON public.optimization_executions
  FOR SELECT
  USING (auth.uid() = user_id);

-- =============================================================================
-- Verification:
--   SELECT * FROM public.optimization_decisions ORDER BY created_at DESC LIMIT 5;
--   SELECT * FROM public.optimization_executions ORDER BY started_at DESC LIMIT 5;
-- =============================================================================
