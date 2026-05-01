-- =============================================================================
-- MIGRATION 024: Native currency amounts for campaigns
-- =============================================================================
-- Goal:
-- - Replace misleading legacy columns budget_usd / spend_usd
-- - Store campaign amounts in native account currency:
--     budget_amount, spend_amount, currency
-- =============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS budget_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS spend_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT;

-- Backfill from legacy columns first.
UPDATE public.campaigns
SET budget_amount = budget_usd
WHERE budget_amount IS NULL AND budget_usd IS NOT NULL;

UPDATE public.campaigns
SET spend_amount = spend_usd
WHERE spend_amount IS NULL AND spend_usd IS NOT NULL;

-- Backfill campaign currency from connected ad account currency when possible.
-- campaigns.platforms[1] is the primary platform convention in this codebase.
UPDATE public.campaigns c
SET currency = a.currency
FROM public.ad_accounts a
WHERE c.currency IS NULL
  AND c.user_id = a.user_id
  AND c.client_id = a.client_id
  AND a.is_active = true
  AND a.platform = COALESCE(c.platforms[1], 'meta')
  AND a.currency IS NOT NULL;

-- Conservative fallback to USD only when currency is still unknown.
UPDATE public.campaigns
SET currency = 'USD'
WHERE currency IS NULL;

-- Enforce not null from now on.
ALTER TABLE public.campaigns
  ALTER COLUMN currency SET NOT NULL;

-- Rename legacy columns to preserve values while forcing new contract usage.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'budget_usd'
  ) THEN
    ALTER TABLE public.campaigns RENAME COLUMN budget_usd TO budget_amount_legacy_usd;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'spend_usd'
  ) THEN
    ALTER TABLE public.campaigns RENAME COLUMN spend_usd TO spend_amount_legacy_usd;
  END IF;
END $$;

-- =============================================================================
-- Verification helpers:
-- SELECT id, budget_amount, spend_amount, currency FROM public.campaigns LIMIT 20;
-- SELECT COUNT(*) FROM public.campaigns WHERE currency IS NULL;
-- =============================================================================
