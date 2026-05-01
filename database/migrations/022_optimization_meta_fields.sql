ALTER TABLE public.optimization_recommendations
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;

CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_prompt_version
  ON public.optimization_recommendations(prompt_version)
  WHERE prompt_version IS NOT NULL;
