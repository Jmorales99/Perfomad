-- =============================================================================
-- MIGRATION 009: benchmark tables
-- Run in Supabase SQL Editor (idempotent).
--
-- WHY: Infra para, a futuro, calcular percentiles internos por segmento
--      (platform + objective + country + spend_tier) y alimentar el prompt IA.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.benchmark_versions (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  version       INTEGER     NOT NULL UNIQUE,
  built_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT        NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal','external','hybrid','general_fallback')),
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS public.benchmark_segments (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  platform      TEXT        NOT NULL,
  objective     TEXT,
  country       TEXT,
  spend_tier    TEXT
    CHECK (spend_tier IN ('xs','s','m','l','xl')),
  UNIQUE (platform, objective, country, spend_tier)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_segments_platform
  ON public.benchmark_segments(platform);

CREATE TABLE IF NOT EXISTS public.benchmark_metric_distributions (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id          UUID        NOT NULL REFERENCES public.benchmark_versions(id) ON DELETE CASCADE,
  segment_id          UUID        NOT NULL REFERENCES public.benchmark_segments(id) ON DELETE CASCADE,
  metric_key          TEXT        NOT NULL,
  sample_size         INTEGER     NOT NULL DEFAULT 0,
  p25                 NUMERIC,
  p50                 NUMERIC,
  p75                 NUMERIC,
  p90                 NUMERIC,
  mean                NUMERIC,
  stddev              NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, segment_id, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_distributions_lookup
  ON public.benchmark_metric_distributions(segment_id, metric_key, version_id);

-- Tablas de referencia publicas solo lectura (a traves del backend).
ALTER TABLE public.benchmark_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read benchmark versions" ON public.benchmark_versions;
CREATE POLICY "Read benchmark versions"
  ON public.benchmark_versions FOR SELECT USING (true);

ALTER TABLE public.benchmark_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read benchmark segments" ON public.benchmark_segments;
CREATE POLICY "Read benchmark segments"
  ON public.benchmark_segments FOR SELECT USING (true);

ALTER TABLE public.benchmark_metric_distributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read benchmark distributions" ON public.benchmark_metric_distributions;
CREATE POLICY "Read benchmark distributions"
  ON public.benchmark_metric_distributions FOR SELECT USING (true);

-- =============================================================================
-- Verification:
--   SELECT * FROM public.benchmark_versions;
--   SELECT * FROM public.benchmark_segments;
--   SELECT * FROM public.benchmark_metric_distributions LIMIT 5;
-- =============================================================================
