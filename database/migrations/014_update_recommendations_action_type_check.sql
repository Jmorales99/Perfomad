-- =============================================================================
-- MIGRATION 014: Add pause_ad + flag_creative to optimization_recommendations
--                action_type CHECK constraint.
--
-- WHY: BuildOptimizationInput always includes "pause_ad" and "flag_creative"
--      in policy.allowed_actions so Claude can recommend them. However,
--      migration 007 created the table with a CHECK that only allows the five
--      original values. When Claude returns "flag_creative" the INSERT fails
--      with a constraint violation, leaving a run as "succeeded" but with zero
--      recommendations and the caller receiving a 500.
-- =============================================================================

ALTER TABLE public.optimization_recommendations
  DROP CONSTRAINT IF EXISTS optimization_recommendations_action_type_check;

ALTER TABLE public.optimization_recommendations
  ADD CONSTRAINT optimization_recommendations_action_type_check
  CHECK (action_type IN (
    'pause_campaign',
    'resume_campaign',
    'adjust_budget',
    'flag_for_review',
    'informational',
    'pause_ad',
    'flag_creative'
  ));

-- =============================================================================
-- Verification:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.optimization_recommendations'::regclass
--     AND conname = 'optimization_recommendations_action_type_check';
-- =============================================================================
